/**
 * End-to-end check against the real Supabase project + deployed site.
 * Creates 3 throwaway users (no passwords; signed in with one-time admin links),
 * runs the main flows as each of them, then deletes everything it created.
 *
 *   npx tsx scripts/e2e-live.ts [siteUrl]
 */
import fs from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { defaultGameSettings } from "../src/lib/defaults";
import { generateSchedule } from "../src/lib/scheduler";
import type { Availability, Shift } from "../src/lib/types";

const env = Object.fromEntries(
  fs
    .readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);
const URL = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY, SVC = env.SUPABASE_SERVICE_ROLE_KEY;
const SITE = process.argv[2] ?? "https://kville-tracker.vercel.app";
const admin = createClient(URL, SVC, { auth: { persistSession: false, autoRefreshToken: false } });

let pass = 0, fail = 0;
const ok = (cond: unknown, label: string, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "✓" : "✗"} ${label}${extra ? `  (${extra})` : ""}`);
};
const must = <T,>(r: { data: T; error: { message: string } | null }, what: string): T => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
};

async function makeUser(tag: string, name: string) {
  const email = `kville-e2e-${tag}-${Date.now()}@example.com`;
  const u = must(await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: name } }), "createUser");
  const link = must(await admin.auth.admin.generateLink({ type: "magiclink", email }), "generateLink");
  const client = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const s = must(await client.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token }), "verifyOtp");
  return { id: u.user!.id, name, client, token: s.session!.access_token };
}

const created: string[] = [];
let groupId: string | null = null;

async function main() {
  console.log(`Testing ${URL.replace(/^https:\/\/(.{4}).*?\./, "https://$1….")} + ${SITE}\n`);
  const A = await makeUser("a", "Test Captain");
  const B = await makeUser("b", "Test Bea");
  const C = await makeUser("c", "Test Cal");
  created.push(A.id, B.id, C.id);
  ok(true, "created 3 test users and signed each in");

  const prof = must(await A.client.from("profiles").select("display_name").eq("id", A.id).single(), "profile");
  ok(prof.display_name === "Test Captain", "profile auto-created with sign-up name");

  // ---- group (game mode, 1/3 rule)
  const settings = defaultGameSettings();
  const start = new Date(Date.now() + 60 * 60_000);
  const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  // timezone-agnostic: settings are in America/New_York; use ET wall clock via Intl
  const et = (d: Date) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour}:00`;
  };
  void local;
  settings.game = { opponent: "Illinois", start: et(start), end: et(new Date(start.getTime() + 36 * 3_600_000)), fraction: 1 / 3 };
  const g = must(await A.client.rpc("create_group", { p_name: "E2E Test Tent", p_settings: settings }), "create_group") as { id: string; invite_code: string };
  groupId = g.id;
  ok(/^[A-Z2-9A-F]{6}$/i.test(g.invite_code), "captain created group with invite code");

  // realtime: A listens for changes
  let events = 0;
  const seen: Record<string, number> = {};
  const ch = A.client.channel("e2e");
  for (const table of ["shifts", "group_members", "swap_requests", "expense_shares"])
    ch.on("postgres_changes", { event: "*", schema: "public", table, filter: table === "expense_shares" ? undefined : `group_id=eq.${g.id}` }, () => {
      events++;
      seen[table] = (seen[table] ?? 0) + 1;
    });
  const status = await new Promise<string>((res) => ch.subscribe((st, err) => ["SUBSCRIBED", "CHANNEL_ERROR", "TIMED_OUT"].includes(st) && res(st + (err ? ` ${err.message}` : ""))));
  ok(status === "SUBSCRIBED", "captain subscribed to live updates", status);
  await new Promise((r) => setTimeout(r, 1000));

  const bad = await B.client.rpc("join_group", { p_code: "ZZZZZZ" });
  ok(bad.error?.message.includes("No group"), "wrong invite code is rejected");
  ok(!must(await B.client.from("groups").select("id").eq("id", g.id), "peek").length, "non-member can't see the group");
  must(await B.client.rpc("join_group", { p_code: g.invite_code }), "join B");
  must(await C.client.rpc("join_group", { p_code: g.invite_code.toLowerCase() }), "join C");
  const members = must(await A.client.from("group_members").select("user_id, role").eq("group_id", g.id), "members");
  ok(members.length === 3, "2 members joined with the code (lowercase works too)");

  // ---- availability: B has class 10:00–10:50 tomorrow ET-ish (use a block 3h from now, 50 min long)
  const blkStart = new Date(Math.ceil((Date.now() + 3 * 3_600_000) / 900_000) * 900_000);
  const blkEnd = new Date(blkStart.getTime() + 50 * 60_000);
  must(await B.client.rpc("replace_my_availability", { p_group: g.id, p_ranges: [{ start: blkStart.toISOString(), end: blkEnd.toISOString(), kind: "unavailable" }] }), "avail");
  const av = must(await A.client.from("availability").select("*").eq("group_id", g.id), "read avail") as Availability[];
  ok(av.length === 1 && Date.parse(av[0].end) - Date.parse(av[0].start) === 50 * 60_000, "member saved a 50-minute block; captain can see it");

  // ---- schedule
  const res = generateSchedule({ settings, memberIds: members.map((m) => m.user_id), availability: av, specials: [], buddies: [], existing: [], now: new Date().toISOString() });
  ok(res.understaffed.length === 0, "scheduler covered every minute with 1 of 3 in the tent", `${res.shifts.length} shifts`);
  const denied = await B.client.rpc("replace_future_shifts", { p_group: g.id, p_from: new Date().toISOString(), p_shifts: res.shifts });
  ok(!!denied.error, "member can't publish a schedule");
  must(await A.client.rpc("replace_future_shifts", { p_group: g.id, p_from: new Date().toISOString(), p_shifts: res.shifts }), "publish");
  must(await A.client.from("groups").update({ published_at: new Date().toISOString() }).eq("id", g.id), "published_at");
  const shifts = must(await B.client.from("shifts").select("*").eq("group_id", g.id).order("start"), "shifts") as Shift[];
  ok(shifts.length === res.shifts.length, "member sees the published schedule");
  ok(!shifts.some((s) => s.user_id === B.id && Date.parse(s.start) < blkEnd.getTime() && blkStart.getTime() < Date.parse(s.end)), "nobody scheduled B during B's class");
  const insertDenied = await B.client.from("shifts").insert({ group_id: g.id, start: start.toISOString(), end: new Date(start.getTime() + 3.6e6).toISOString(), user_id: B.id });
  ok(!!insertDenied.error, "member can't add shifts directly");

  // ---- partial swap: B gives the first 30 min of a shift to C
  const bShift = shifts.find((s) => s.user_id === B.id && Date.parse(s.end) - Date.parse(s.start) >= 3_600_000 &&
    !shifts.some((x) => x.user_id === C.id && Date.parse(x.start) < Date.parse(s.start) + 1_800_000 && Date.parse(s.start) < Date.parse(x.end)));
  if (bShift) {
    const partEnd = new Date(Date.parse(bShift.start) + 30 * 60_000).toISOString();
    const sw = must(await B.client.from("swap_requests").insert({ group_id: g.id, shift_id: bShift.id, from_user: B.id, to_user: C.id, start: bShift.start, end: partEnd }).select("id").single(), "swap req");
    const wrong = await A.client.rpc("respond_swap", { p_swap: sw.id, p_accept: true });
    ok(!!wrong.error, "only the person asked can accept a cover request");
    must(await C.client.rpc("respond_swap", { p_swap: sw.id, p_accept: true }), "accept");
    const after = must(await A.client.from("shifts").select("*").eq("group_id", g.id), "after") as Shift[];
    const cPart = after.find((s) => s.user_id === C.id && s.start === new Date(bShift.start).toISOString().replace(".000Z", "+00:00") || (s.user_id === C.id && Date.parse(s.start) === Date.parse(bShift.start) && Date.parse(s.end) === Date.parse(partEnd)));
    const bRest = after.find((s) => s.id === bShift.id);
    ok(!!cPart && cPart.source === "swap", "C took just the first 30 min");
    ok(!!bRest && Date.parse(bRest.start) === Date.parse(partEnd) && bRest.user_id === B.id, "B kept the rest of the shift");
    ok(Math.abs(Number(cPart?.weight ?? 0) + Number(bRest?.weight ?? 0) - Number(bShift.weight)) < 0.02, "points split between them");
  } else ok(false, "found a shift of B's to swap");

  // ---- money
  const eid = must(await A.client.rpc("create_expense", { p_group: g.id, p_title: "Tarp", p_total: 3000, p_buyer: A.id, p_shares: members.map((m) => ({ user_id: m.user_id, amount_cents: 1000 })) }), "expense") as string;
  await B.client.from("expense_shares").update({ paid_at: new Date().toISOString() }).eq("expense_id", eid).eq("user_id", B.id);
  let shares = must(await A.client.from("expense_shares").select("*").eq("expense_id", eid), "shares");
  ok(!shares.find((s: { user_id: string; paid_at: string | null }) => s.user_id === B.id)!.paid_at, "member can't mark themselves paid");
  must(await A.client.from("expense_shares").update({ paid_at: new Date().toISOString() }).eq("expense_id", eid).eq("user_id", B.id), "mark paid");
  shares = must(await C.client.from("expense_shares").select("*").eq("expense_id", eid), "shares C");
  ok(!!shares.find((s: { user_id: string; paid_at: string | null }) => s.user_id === B.id)!.paid_at, "buyer marked B paid; C sees it");

  // ---- live site API routes
  const n1 = await fetch(`${SITE}/api/push/notify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ groupId: g.id, userIds: "all", title: "x" }) });
  ok(n1.status === 401, "push API rejects signed-out callers");
  const n2 = await fetch(`${SITE}/api/push/notify`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${B.token}` }, body: JSON.stringify({ groupId: g.id, userIds: "all", title: "Tent check (test)", body: "e2e" }) });
  ok(n2.status === 200, "push API accepts a member's tent-check alert", `${n2.status} ${await n2.text()}`);
  const tok = must(await B.client.from("profiles").select("calendar_token").eq("id", B.id).single(), "token") as { calendar_token: string };
  const ics = await (await fetch(`${SITE}/api/ics/${tok.calendar_token}`)).text();
  const bCount = must(await A.client.from("shifts").select("id", { count: "exact", head: false }).eq("group_id", g.id).eq("user_id", B.id), "count").length;
  ok((ics.match(/BEGIN:VEVENT/g) ?? []).length === bCount && ics.includes("VALARM"), "calendar feed lists B's shifts with alarms", `${bCount} events`);

  await new Promise((r) => setTimeout(r, 3000));
  ok(events > 0, "live updates reached the captain in real time", JSON.stringify(seen));
  await A.client.removeChannel(ch);
}

main()
  .catch((e) => {
    fail++;
    console.log("✗ crashed:", e.message);
  })
  .finally(async () => {
    if (groupId) await admin.from("groups").delete().eq("id", groupId);
    for (const id of created) await admin.auth.admin.deleteUser(id);
    const left = groupId ? (await admin.from("groups").select("id").eq("id", groupId)).data?.length : 0;
    console.log(`\ncleanup: deleted test group and ${created.length} users${left ? " (group still present!)" : ""}`);
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });
