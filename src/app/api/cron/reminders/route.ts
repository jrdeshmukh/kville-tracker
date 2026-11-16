import { NextResponse } from "next/server";
import { adminClient, pushToUsers } from "@/lib/server/admin";

/**
 * Call every ~5 minutes (cron-job.org, GitHub Actions, Supabase pg_cron…) with
 *   Authorization: Bearer $CRON_SECRET
 * Sends a reminder for every shift starting within its group's reminder window.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const sb = adminClient();
  const now = Date.now();
  const horizon = new Date(now + 3 * 3_600_000).toISOString();
  const { data: shifts, error } = await sb
    .from("shifts")
    .select("id, user_id, start, end, is_night, group_id, groups(name, settings)")
    .is("reminded_at", null)
    .gt("start", new Date(now).toISOString())
    .lt("start", horizon);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type G = { name: string; settings: { reminderMinutes?: number; timezone?: string } } | null;
  const due = (shifts ?? []).filter((s) => Date.parse(s.start) - now <= ((s.groups as unknown as G)?.settings?.reminderMinutes ?? 30) * 60_000);
  if (!due.length) return NextResponse.json({ reminded: 0, sent: 0 });

  // Claim the rows first (only ones still unclaimed), so overlapping runs never double-send.
  const { data: claimed, error: claimErr } = await sb
    .from("shifts")
    .update({ reminded_at: new Date().toISOString() })
    .in("id", due.map((s) => s.id))
    .is("reminded_at", null)
    .select("id");
  if (claimErr) return NextResponse.json({ error: claimErr.message }, { status: 500 });
  const mine = new Set((claimed ?? []).map((r) => r.id as string));

  let sent = 0;
  const done: string[] = [];
  for (const s of due) {
    if (!mine.has(s.id)) continue;
    const g = s.groups as unknown as G;
    const time = new Date(s.start).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: g?.settings?.timezone ?? "America/New_York" });
    sent += await pushToUsers([s.user_id], {
      title: s.is_night ? "🌙 Night shift soon" : "⛺ Tent shift soon",
      body: `${g?.name ?? "Your tent"}: you're on at ${time}. Bring layers!`,
      url: `/g/${s.group_id}`,
    });
    done.push(s.id);
  }
  return NextResponse.json({ reminded: done.length, sent });
}
