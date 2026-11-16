import { adminClient } from "@/lib/server/admin";
import { buildIcs } from "@/lib/ics";

/** Private calendar feed: /api/ics/<calendar_token>. Subscribe from Apple/Google Calendar. */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(token)) return new Response("not found", { status: 404 });
  const sb = adminClient();
  const { data: profile } = await sb.from("profiles").select("id").eq("calendar_token", token).maybeSingle();
  if (!profile) return new Response("not found", { status: 404 });
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const { data: shifts } = await sb
    .from("shifts")
    .select("id, start, end, is_night, groups(settings)")
    .eq("user_id", profile.id)
    .gt("end", since)
    .order("start");
  const reminder = (shifts?.[0]?.groups as unknown as { settings?: { reminderMinutes?: number } } | null)?.settings?.reminderMinutes ?? 30;
  const ics = buildIcs("K-Ville shifts", shifts ?? [], reminder, new URL("/", req.url).toString());
  return new Response(ics, {
    headers: { "content-type": "text/calendar; charset=utf-8", "cache-control": "no-store" },
  });
}
