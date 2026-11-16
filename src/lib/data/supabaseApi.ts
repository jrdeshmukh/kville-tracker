import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeSettings } from "../defaults";
import type { Expense, Group, GroupBundle, Member, Profile } from "../types";
import type { DataApi } from "./api";

function must<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

export function createSupabaseApi(url: string, key: string): DataApi {
  const sb: SupabaseClient = createBrowserClient(url, key);
  let cachedUid: string | null | undefined;

  const uid = async () => {
    if (cachedUid !== undefined) return cachedUid;
    const { data } = await sb.auth.getSession();
    cachedUid = data.session?.user.id ?? null;
    return cachedUid;
  };
  sb.auth.onAuthStateChange((_e, session) => {
    cachedUid = session?.user.id ?? null;
  });
  const token = async () => (await sb.auth.getSession()).data.session?.access_token;
  const fixGroup = (g: Group): Group => ({ ...g, settings: normalizeSettings(g.settings) });

  const api: DataApi = {
    mode: "supabase",
    currentUserId: uid,
    async signIn() {
      await sb.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(location.pathname + location.search)}` },
      });
    },
    async signInWithPassword(email, password) {
      const { data, error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw new Error(error.message === "Invalid login credentials" ? "Wrong email or password" : error.message);
      cachedUid = data.user?.id ?? null;
    },
    async signUp(email, password, name) {
      const { data, error } = await sb.auth.signUp({
        email: email.trim(),
        password,
        options: { data: { full_name: name.trim() || email.split("@")[0] }, emailRedirectTo: location.origin },
      });
      if (error) throw new Error(error.message);
      if (!data.session) return "confirm_email";
      cachedUid = data.user?.id ?? null;
      return "signed_in";
    },
    async signOut() {
      await sb.auth.signOut();
      cachedUid = null;
    },
    onAuthChange(cb) {
      const { data } = sb.auth.onAuthStateChange(() => cb());
      return () => data.subscription.unsubscribe();
    },

    async getProfile() {
      const id = await uid();
      if (!id) return null;
      return must(await sb.from("profiles").select("id,display_name,venmo,avatar_url").eq("id", id).maybeSingle()) as Profile | null;
    },
    async updateProfile(patch) {
      const id = await uid();
      must(await sb.from("profiles").update(patch).eq("id", id));
    },
    async calendarFeedUrl() {
      const id = await uid();
      if (!id) return null;
      const p = must(await sb.from("profiles").select("calendar_token").eq("id", id).single()) as { calendar_token: string };
      return `${location.origin}/api/ics/${p.calendar_token}`;
    },

    async listMyGroups() {
      const id = await uid();
      if (!id) return [];
      const rows = must(
        await sb.from("group_members").select("role, groups(*, group_members(count))").eq("user_id", id),
      ) as unknown as { role: "admin" | "member"; groups: Group & { group_members: { count: number }[] } }[];
      return rows
        .filter((r) => r.groups)
        .map((r) => ({ role: r.role, group: fixGroup(r.groups), memberCount: r.groups.group_members?.[0]?.count ?? 0 }));
    },
    async createGroup(name, settings) {
      return fixGroup(must(await sb.rpc("create_group", { p_name: name, p_settings: settings })) as Group);
    },
    async joinGroup(code) {
      return must(await sb.rpc("join_group", { p_code: code })) as string;
    },
    async getBundle(groupId) {
      const [g, mem, av, sp, sh, sw, ex, ge, bu, al] = await Promise.all([
        sb.from("groups").select("*").eq("id", groupId).single(),
        sb.from("group_members").select("*, profile:profiles(id,display_name,venmo,avatar_url)").eq("group_id", groupId),
        sb.from("availability").select("*").eq("group_id", groupId),
        sb.from("special_periods").select("*").eq("group_id", groupId).order("start"),
        sb.from("shifts").select("id,group_id,start,end,user_id,is_night,weight,source,checked_in_at").eq("group_id", groupId).order("start"),
        sb.from("swap_requests").select("*").eq("group_id", groupId).order("created_at", { ascending: false }),
        sb.from("expenses").select("*, shares:expense_shares(*)").eq("group_id", groupId).order("created_at", { ascending: false }),
        sb.from("gear_items").select("*").eq("group_id", groupId).order("name"),
        sb.from("buddies").select("*").eq("group_id", groupId),
        sb.from("alerts").select("*").eq("group_id", groupId).order("created_at", { ascending: false }).limit(20),
      ]);
      const bundle: GroupBundle = {
        group: fixGroup(must(g) as Group),
        members: (must(mem) as Member[]).filter((m) => m.profile),
        availability: must(av) ?? [],
        specials: must(sp) ?? [],
        shifts: (must(sh) ?? []).map((s: { weight: number | string }) => ({ ...s, weight: Number(s.weight) })) as GroupBundle["shifts"],
        swaps: must(sw) ?? [],
        expenses: (must(ex) ?? []) as Expense[],
        gear: must(ge) ?? [],
        buddies: must(bu) ?? [],
        alerts: must(al) ?? [],
      };
      return bundle;
    },
    async updateGroup(groupId, patch) {
      must(await sb.from("groups").update(patch).eq("id", groupId));
    },
    async deleteGroup(groupId) {
      must(await sb.from("groups").delete().eq("id", groupId));
    },
    async setRole(groupId, userId, role) {
      must(await sb.from("group_members").update({ role }).eq("group_id", groupId).eq("user_id", userId));
    },
    async removeMember(groupId, userId) {
      must(await sb.from("group_members").delete().eq("group_id", groupId).eq("user_id", userId));
    },
    async markSubmitted(groupId, done) {
      must(await sb.rpc("mark_submitted", { p_group: groupId, p_done: done }));
    },
    async replaceMyAvailability(groupId, ranges) {
      must(await sb.rpc("replace_my_availability", { p_group: groupId, p_ranges: ranges }));
    },
    async addSpecial(groupId, p) {
      must(await sb.from("special_periods").insert({ group_id: groupId, ...p }));
    },
    async deleteSpecial(id) {
      must(await sb.from("special_periods").delete().eq("id", id));
    },
    async replaceFutureShifts(groupId, fromIso, shifts) {
      must(await sb.rpc("replace_future_shifts", { p_group: groupId, p_from: fromIso, p_shifts: shifts }));
    },
    async addShift(groupId, s) {
      must(await sb.from("shifts").insert({ group_id: groupId, ...s }));
    },
    async deleteShift(id) {
      must(await sb.from("shifts").delete().eq("id", id));
    },
    async reassignShift(id, userId, range) {
      must(await sb.rpc("reassign_part", { p_shift: id, p_user: userId, p_start: range?.start ?? null, p_end: range?.end ?? null }));
    },
    async checkIn(shiftId) {
      must(await sb.rpc("check_in", { p_shift: shiftId }));
    },
    async requestSwap(groupId, shiftId, fromUser, toUser, range) {
      must(
        await sb.from("swap_requests").insert({
          group_id: groupId, shift_id: shiftId, from_user: fromUser, to_user: toUser, start: range?.start ?? null, end: range?.end ?? null,
        }),
      );
    },
    async respondSwap(swapId, accept) {
      must(await sb.rpc("respond_swap", { p_swap: swapId, p_accept: accept }));
    },
    async cancelSwap(swapId) {
      must(await sb.from("swap_requests").update({ status: "cancelled" }).eq("id", swapId));
    },
    async createExpense(groupId, e) {
      must(
        await sb.rpc("create_expense", {
          p_group: groupId, p_title: e.title, p_total: e.total_cents, p_buyer: e.buyer_id, p_shares: e.shares,
        }),
      );
    },
    async deleteExpense(id) {
      must(await sb.from("expenses").delete().eq("id", id));
    },
    async setBuyer(expenseId, buyerId) {
      must(await sb.from("expenses").update({ buyer_id: buyerId }).eq("id", expenseId));
    },
    async setPaid(expenseId, userId, paid) {
      must(
        await sb.from("expense_shares").update({ paid_at: paid ? new Date().toISOString() : null })
          .eq("expense_id", expenseId).eq("user_id", userId),
      );
    },
    async addGear(groupId, name) {
      must(await sb.from("gear_items").insert({ group_id: groupId, name }));
    },
    async updateGear(id, patch) {
      must(await sb.from("gear_items").update(patch).eq("id", id));
    },
    async deleteGear(id) {
      must(await sb.from("gear_items").delete().eq("id", id));
    },
    async setBuddies(groupId, buddyIds) {
      const id = await uid();
      must(await sb.from("buddies").delete().eq("group_id", groupId).eq("user_id", id));
      if (buddyIds.length)
        must(await sb.from("buddies").insert(buddyIds.map((b) => ({ group_id: groupId, user_id: id, buddy_id: b }))));
    },
    async sendAlert(groupId, message) {
      const id = await uid();
      must(await sb.from("alerts").insert({ group_id: groupId, created_by: id, message }));
      await api.notify(groupId, "all", "🚨 TENT CHECK", message);
    },
    async notify(groupId, userIds, title, body) {
      const t = await token();
      if (!t) return;
      await fetch("/api/push/notify", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${t}` },
        body: JSON.stringify({ groupId, userIds, title, body }),
      }).catch(() => {});
    },
    async savePushSubscription(sub) {
      const id = await uid();
      must(await sb.from("push_subscriptions").upsert({ endpoint: sub.endpoint, user_id: id, subscription: sub }));
    },
    subscribe(groupId, onChange) {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const bump = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(onChange, 250);
      };
      const ch = sb.channel(`group-${groupId}-${Math.random().toString(36).slice(2)}`);
      for (const table of ["groups", "group_members", "availability", "special_periods", "shifts", "swap_requests", "expenses", "expense_shares", "gear_items", "buddies", "alerts"]) {
        const filter = table === "groups" ? `id=eq.${groupId}` : table === "expense_shares" ? undefined : `group_id=eq.${groupId}`;
        ch.on("postgres_changes", { event: "*", schema: "public", table, ...(filter ? { filter } : {}) }, bump);
      }
      // re-fetch once connected, so nothing that changed while connecting is missed
      ch.subscribe((status) => {
        if (status === "SUBSCRIBED") bump();
      });
      return () => {
        if (timer) clearTimeout(timer);
        sb.removeChannel(ch);
      };
    },
  };
  return api;
}
