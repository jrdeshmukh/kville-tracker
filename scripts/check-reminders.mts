// Creates a throwaway shift starting in 10 minutes, waits for the 5-minute reminder timer
// to mark it reminded, then deletes everything. Run: npx tsx scripts/check-reminders.mts
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const u = (await admin.auth.admin.createUser({ email: `kville-reminder-check-${Date.now()}@example.com`, email_confirm: true })).data.user!;
const g = (await admin.from("groups").insert({ name: "Reminder check", invite_code: "RC" + Math.random().toString(36).slice(2, 6).toUpperCase(), settings: { reminderMinutes: 30 }, created_by: u.id }).select("id").single()).data!;
const start = new Date(Date.now() + 10 * 60_000);
const sh = (await admin.from("shifts").insert({ group_id: g.id, user_id: u.id, start: start.toISOString(), end: new Date(start.getTime() + 3_600_000).toISOString(), weight: 1, source: "manual" }).select("id").single()).data!;
const t0 = Date.now();
console.log(`test shift created; waiting for the timer (runs on every :00/:05/:10… minute)`);
let reminded: string | null = null;
while (Date.now() - t0 < 7 * 60_000) {
  await new Promise((r) => setTimeout(r, 15_000));
  reminded = (await admin.from("shifts").select("reminded_at").eq("id", sh.id).single()).data?.reminded_at ?? null;
  if (reminded) break;
}
console.log(reminded ? `✓ timer called the site and the shift was marked reminded after ${Math.round((Date.now() - t0) / 1000)}s` : "✗ not reminded within 7 minutes");
await admin.from("groups").delete().eq("id", g.id);
await admin.auth.admin.deleteUser(u.id);
console.log("cleanup done");
process.exit(reminded ? 0 : 1);
