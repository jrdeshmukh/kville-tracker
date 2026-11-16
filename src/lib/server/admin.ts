import "server-only";
import { createClient } from "@supabase/supabase-js";
import { sendNotification, setVapidDetails, type PushSubscription } from "web-push";

export function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase server env vars missing");
  return createClient(url, key, { auth: { persistSession: false } });
}

let configured = false;
function configurePush() {
  if (configured) return true;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@example.com", pub, priv);
  configured = true;
  return true;
}

/** Send a push to every device of the given users. Dead subscriptions are cleaned up. */
export async function pushToUsers(userIds: string[], payload: { title: string; body: string; url?: string }) {
  if (!userIds.length || !configurePush()) return 0;
  const sb = adminClient();
  const { data } = await sb.from("push_subscriptions").select("endpoint, subscription").in("user_id", userIds);
  let sent = 0;
  await Promise.all(
    (data ?? []).map(async (row) => {
      try {
        await sendNotification(row.subscription as PushSubscription, JSON.stringify(payload), { TTL: 3600, urgency: "high" });
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await sb.from("push_subscriptions").delete().eq("endpoint", row.endpoint);
      }
    }),
  );
  return sent;
}
