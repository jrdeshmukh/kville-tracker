"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthCard } from "@/components/AuthCard";
import { DemoBar } from "@/components/DemoBar";
import { Avatar, Logo, Moon, Shapes, Spinner, TentBadge, TentGlyph } from "@/components/ui";
import { useSession, useToast } from "@/lib/data/client";
import { badgeLabel, currentBadge } from "@/lib/groupLogic";
import type { GroupSummary } from "@/lib/types";

export default function Home() {
  const { userId, loading } = useSession();
  if (loading) return <Spinner />;
  return userId ? <GroupsHome /> : <Landing />;
}

function Landing() {
  const { api } = useSession();
  const features = [
    { color: "bg-lime", title: "Fair by design", body: "Nights count more than days, cold nights more than mild ones. The scheduler evens out everyone's weighted hours." },
    { color: "bg-coral", title: "Can't make it?", body: "Tap your shift and get a ranked list of who can cover, based on who's free and who has done the least." },
    { color: "bg-sky", title: "Tent check!", body: "One button pings the whole group. See who's on now and who has checked in." },
    { color: "bg-peach", title: "Who paid?", body: "Split the tent, the heater and the pizza. Names turn green once someone has paid." },
  ];
  return (
    <main className="mx-auto max-w-5xl px-4 pb-16 pt-4">
      <nav className="flex items-center justify-between rounded-full border border-ink/70 bg-paper/80 py-2 pl-5 pr-2 backdrop-blur">
        <Logo />
        {api.mode === "demo" ? (
          <button onClick={() => api.signIn()} className="btn-primary btn-sm">
            Try the demo
          </button>
        ) : (
          <a href="#auth" className="btn-primary btn-sm">
            Sign in
          </a>
        )}
      </nav>

      <div className="mt-12 grid gap-8 md:mt-20 md:grid-cols-[1.4fr_1fr] md:items-end">
        <h1 className="h-display rise text-[56px] md:text-[96px]">
          Tent smarter,
          <br />
          not colder.
        </h1>
        <p className="rise max-w-sm text-[17px] leading-snug text-ink-2">
          K-Ville Tracker plans your tent&apos;s shifts, handles swaps and tent checks, and keeps track of who still owes for the
          heater. <span className="hand text-[22px] text-ink">Go to hell, Carolina.</span>
        </p>
      </div>

      <div className="rise mt-10 overflow-hidden rounded-[28px] border border-line">
        <Shapes cols={10} seed={3} />
      </div>

      <div id="auth" className="mt-8 flex flex-col gap-3">
        <AuthCard />
        {api.mode === "demo" && (
          <p className="font-mono text-[12px] text-muted">Demo mode: data stays in this browser. Add Supabase keys to go live.</p>
        )}
      </div>

      <div className="mt-14 grid gap-3 sm:grid-cols-2">
        {features.map((f) => (
          <div key={f.title} className="card rise flex gap-4 p-5">
            <span className={`mt-1 size-9 shrink-0 rounded-full ${f.color}`} />
            <div>
              <h3 className="text-lg font-semibold tracking-tight">{f.title}</h3>
              <p className="mt-1 text-[15px] leading-snug text-ink-2">{f.body}</p>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}

function GroupsHome() {
  const { api, profile } = useSession();
  const router = useRouter();
  const toast = useToast();
  const [groups, setGroups] = useState<GroupSummary[] | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.listMyGroups().then(setGroups).catch((e) => toast(e.message, "error"));
  }, [api, toast]);

  const join = async () => {
    setBusy(true);
    try {
      const id = await api.joinGroup(code);
      router.push(`/g/${id}`);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DemoBar />
      <main className="mx-auto max-w-xl px-4 pb-16 pt-4">
        <header className="flex items-center justify-between">
          <Logo />
          {profile && (
            <Link href="/profile" aria-label="Profile">
              <Avatar id={profile.id} name={profile.display_name} size={36} />
            </Link>
          )}
        </header>

        <h1 className="h-display rise mt-10 text-[44px]">
          Hey {profile?.display_name.split(" ")[0] ?? "there"}.
          <br />
          <span className="text-ink-2">Pick a tent.</span>
        </h1>

        <div className="mt-8 space-y-3">
          {groups === null && <div className="card h-24 animate-pulse" />}
          {groups?.map(({ group, role, memberCount }) => {
            const kind = currentBadge(group.settings);
            return (
              <Link key={group.id} href={`/g/${group.id}`} className="card rise flex items-center justify-between gap-3 p-5 transition hover:border-ink">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <TentBadge type={kind} label={badgeLabel(group.settings, kind)} />
                    {role === "admin" && <span className="chip py-0.5 font-mono text-[11px]">ADMIN</span>}
                  </div>
                  <h2 className="mt-2 truncate text-2xl font-semibold tracking-tight">{group.name}</h2>
                  <p className="text-[14px] text-ink-2">
                    {memberCount} {memberCount === 1 ? "member" : "members"} · {group.published_at ? "schedule live" : "planning"}
                  </p>
                </div>
                <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-ink text-paper">→</span>
              </Link>
            );
          })}
          {groups?.length === 0 && (
            <div className="card flex items-center gap-4 p-5 text-ink-2">
              <Moon size={20} /> No tents yet. Start one or join with a code.
            </div>
          )}
        </div>

        <div className="mt-6 grid gap-3">
          <Link href="/new" className="rise flex items-center justify-between rounded-[28px] bg-lime p-5 transition hover:brightness-95">
            <div>
              <p className="label !text-ink/60">Captain?</p>
              <p className="text-xl font-semibold tracking-tight">Start a new tent group</p>
            </div>
            <span className="flex size-11 items-center justify-center rounded-full bg-ink text-paper">
              <TentGlyph />
            </span>
          </Link>
          <div className="card rise p-5">
            <p className="label">Have an invite code?</p>
            <div className="mt-3 flex gap-2">
              <input
                className="input font-mono uppercase tracking-[0.2em]"
                placeholder="ABC123"
                value={code}
                maxLength={8}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && code && join()}
                aria-label="Invite code"
              />
              <button className="btn-primary" disabled={!code || busy} onClick={join}>
                Join
              </button>
            </div>
            {api.mode === "demo" && <p className="mt-2 font-mono text-[11px] text-muted">Demo code: DEMO42</p>}
          </div>
        </div>
      </main>
    </>
  );
}
