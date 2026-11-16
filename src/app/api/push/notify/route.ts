import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { adminClient, pushToUsers } from "@/lib/server/admin";

/** Members can notify other members of the same group (cover requests, tent checks, schedule updates). */
export async function POST(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const { data: u } = await userClient.auth.getUser(token);
  if (!u.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { groupId?: string; userIds?: string[] | "all"; title?: string; body?: string } | null;
  if (!body?.groupId || !body.title) return NextResponse.json({ error: "bad request" }, { status: 400 });

  const sb = adminClient();
  const { data: members } = await sb.from("group_members").select("user_id").eq("group_id", body.groupId);
  const ids = new Set((members ?? []).map((m) => m.user_id as string));
  if (!ids.has(u.user.id)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const targets = (body.userIds === "all" ? [...ids] : (body.userIds ?? []).filter((x) => ids.has(x))).filter((x) => x !== u.user!.id || body.userIds !== "all");
  const sent = await pushToUsers(targets, {
    title: String(body.title).slice(0, 80),
    body: String(body.body ?? "").slice(0, 200),
    url: `/g/${body.groupId}`,
  });
  return NextResponse.json({ sent });
}
