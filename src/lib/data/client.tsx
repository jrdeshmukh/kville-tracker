"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { DataApi } from "./api";
import { createDemoApi } from "./demoApi";
import { createSupabaseApi } from "./supabaseApi";
import type { GroupBundle, Member, Profile } from "../types";

let singleton: DataApi | null = null;
export function getApi(): DataApi {
  if (singleton) return singleton;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  singleton = url && key ? createSupabaseApi(url, key) : createDemoApi();
  return singleton;
}

interface SessionCtx {
  api: DataApi;
  userId: string | null;
  profile: Profile | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
}
const Session = createContext<SessionCtx | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const api = useMemo(getApi, []);
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    const id = await api.currentUserId();
    setUserId(id);
    setProfile(id ? await api.getProfile() : null);
    setLoading(false);
  }, [api]);
  useEffect(() => {
    refresh();
    return api.onAuthChange(() => refresh());
  }, [api, refresh]);
  return (
    <Session.Provider value={{ api, userId, profile, loading, refreshProfile: refresh }}>{children}</Session.Provider>
  );
}

export function useSession() {
  const c = useContext(Session);
  if (!c) throw new Error("SessionProvider missing");
  return c;
}

// ---------------------------------------------------------------- group

interface GroupCtx {
  bundle: GroupBundle;
  me: Member;
  isAdmin: boolean;
  refresh: () => Promise<void>;
  memberName: (id: string | null | undefined) => string;
  member: (id: string) => Member | undefined;
  /** run an action, show errors, refresh */
  run: <T>(fn: () => Promise<T>, okMsg?: string) => Promise<T | undefined>;
}
const GroupContext = createContext<GroupCtx | null>(null);

export function GroupProvider({ groupId, children, fallback }: { groupId: string; children: React.ReactNode; fallback: (s: { error: string | null }) => React.ReactNode }) {
  const { api, userId } = useSession();
  const [bundle, setBundle] = useState<GroupBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const refresh = useCallback(async () => {
    try {
      setBundle(await api.getBundle(groupId));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api, groupId]);

  useEffect(() => {
    if (!userId) return;
    refresh();
    return api.subscribe(groupId, refresh);
  }, [api, groupId, refresh, userId]);

  const value = useMemo<GroupCtx | null>(() => {
    if (!bundle || !userId) return null;
    const me = bundle.members.find((m) => m.user_id === userId);
    if (!me) return null;
    const byId = new Map(bundle.members.map((m) => [m.user_id, m]));
    return {
      bundle,
      me,
      isAdmin: me.role === "admin",
      refresh,
      member: (id) => byId.get(id),
      memberName: (id) => (id ? byId.get(id)?.profile.display_name ?? "Former member" : "Unassigned"),
      run: async (fn, okMsg) => {
        try {
          const r = await fn();
          if (okMsg) toast(okMsg);
          await refresh();
          return r;
        } catch (e) {
          toast((e as Error).message, "error");
          return undefined;
        }
      },
    };
  }, [bundle, userId, refresh, toast]);

  if (!value) return <>{fallback({ error: error ?? (bundle ? "You're not a member of this group." : null) })}</>;
  return <GroupContext.Provider value={value}>{children}</GroupContext.Provider>;
}

export function useGroup() {
  const c = useContext(GroupContext);
  if (!c) throw new Error("GroupProvider missing");
  return c;
}

// ---------------------------------------------------------------- toasts

type ToastFn = (msg: string, kind?: "ok" | "error") => void;
const ToastContext = createContext<ToastFn>(() => {});
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<{ id: number; msg: string; kind: "ok" | "error" }[]>([]);
  const push = useCallback<ToastFn>((msg, kind = "ok") => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, msg, kind }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 3500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-[100] flex flex-col items-center gap-2 px-4">
        {items.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto rounded-full px-5 py-2.5 text-sm font-medium shadow-lg ${t.kind === "error" ? "bg-coral text-ink" : "bg-ink text-paper"}`}
          >
            {t.msg}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
export const useToast = () => useContext(ToastContext);
