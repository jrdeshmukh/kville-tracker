"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { DemoBar } from "@/components/DemoBar";
import { Avatar, Logo, Section, Spinner } from "@/components/ui";
import { useSession, useToast } from "@/lib/data/client";
import { enablePush } from "@/lib/push";

export default function ProfilePage() {
  const { api, profile, loading, userId, refreshProfile } = useSession();
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState("");
  const [venmo, setVenmo] = useState("");
  const [feed, setFeed] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !userId) router.replace("/");
  }, [loading, userId, router]);
  useEffect(() => {
    if (profile) {
      setName(profile.display_name);
      setVenmo(profile.venmo ?? "");
    }
  }, [profile]);
  useEffect(() => {
    api.calendarFeedUrl().then(setFeed).catch(() => {});
  }, [api]);

  if (loading || !profile) return <Spinner />;
  const dirty = name !== profile.display_name || venmo !== (profile.venmo ?? "");

  return (
    <>
      <DemoBar />
      <main className="mx-auto max-w-xl space-y-7 px-4 pb-16 pt-4">
        <header className="flex items-center justify-between">
          <Logo />
          <button className="btn-ghost btn-sm" onClick={() => router.back()}>
            Back
          </button>
        </header>
        <div className="rise flex items-center gap-4">
          <Avatar id={profile.id} name={name || profile.display_name} size={64} />
          <h1 className="h-display text-[36px]">{name || "Your profile"}</h1>
        </div>

        <Section title="Profile">
          <div className="card space-y-3 p-4">
            <label className="block">
              <span className="label">Display name</span>
              <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
            </label>
            <label className="block">
              <span className="label">Venmo username</span>
              <input className="input mt-1" placeholder="@your-venmo" value={venmo} onChange={(e) => setVenmo(e.target.value.trim())} />
              <span className="mt-1 block text-[12px] text-ink-2">So people can pay you back in one tap.</span>
            </label>
            <button
              className="btn-primary w-full"
              disabled={!dirty || !name.trim()}
              onClick={async () => {
                try {
                  await api.updateProfile({ display_name: name.trim(), venmo: venmo.replace(/^@/, "") || null });
                  await refreshProfile();
                  toast("Saved");
                } catch (e) {
                  toast((e as Error).message, "error");
                }
              }}
            >
              Save
            </button>
          </div>
        </Section>

        <Section title="Reminders">
          <div className="card space-y-3 p-4">
            <div>
              <p className="font-semibold">Push notifications</p>
              <p className="text-[13px] text-ink-2">Shift reminders, cover requests and tent checks. On iPhone, first tap Share → Add to Home Screen, then open from there.</p>
              <button
                className="btn-ghost btn-sm mt-2"
                disabled={api.mode === "demo"}
                onClick={() => enablePush(api).then(() => toast("Notifications on")).catch((e) => toast(e.message, "error"))}
              >
                {api.mode === "demo" ? "Not available in demo" : "Enable on this device"}
              </button>
            </div>
            <div className="border-t border-line pt-3">
              <p className="font-semibold">Calendar sync</p>
              <p className="text-[13px] text-ink-2">Subscribe once and your shifts stay up to date in Google or Apple Calendar, with alarms.</p>
              {feed ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <a className="btn-primary btn-sm" href={feed.replace(/^https?:/, "webcal:")}>
                    Subscribe (Apple)
                  </a>
                  <a className="btn-ghost btn-sm" href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(feed.replace(/^https?:/, "webcal:"))}`} target="_blank" rel="noreferrer">
                    Add to Google
                  </a>
                  <button
                    className="btn-ghost btn-sm"
                    onClick={() => navigator.clipboard.writeText(feed).then(() => toast("Feed link copied"))}
                  >
                    Copy link
                  </button>
                </div>
              ) : (
                <p className="mt-2 text-[13px] text-muted">Live sync needs the hosted version. Use “Export my shifts” on the Schedule tab instead.</p>
              )}
            </div>
          </div>
        </Section>

        <button
          className="btn-ghost w-full"
          onClick={async () => {
            await api.signOut();
            router.replace("/");
          }}
        >
          Sign out
        </button>
      </main>
    </>
  );
}
