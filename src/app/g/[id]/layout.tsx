"use client";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { DemoBar } from "@/components/DemoBar";
import { Avatar, Spinner, TentBadge } from "@/components/ui";
import { GroupProvider, useGroup, useSession } from "@/lib/data/client";
import { badgeLabel, periodAt } from "@/lib/groupLogic";

export default function GroupLayout({ children }: { children: React.ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const { userId, loading } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (!loading && !userId) router.replace("/");
  }, [loading, userId, router]);
  if (loading || !userId) return <Spinner />;
  return (
    <GroupProvider
      groupId={id}
      fallback={({ error }) =>
        error ? (
          <main className="mx-auto max-w-md px-4 pt-20 text-center">
            <p className="text-lg">{error}</p>
            <Link href="/" className="btn-primary mt-6">
              Back home
            </Link>
          </main>
        ) : (
          <Spinner />
        )
      }
    >
      <Shell>{children}</Shell>
    </GroupProvider>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const { bundle, me } = useGroup();
  const { profile } = useSession();
  const path = usePathname();
  const base = `/g/${bundle.group.id}`;
  const phase = periodAt(bundle.group.settings, new Date().toISOString());
  const pendingForMe = bundle.swaps.filter((s) => s.status === "pending" && s.to_user === me.user_id).length;

  const tabs = [
    { href: base, label: "Now", icon: IconNow, badge: pendingForMe },
    { href: `${base}/schedule`, label: "Schedule", icon: IconCal },
    { href: `${base}/times`, label: "My times", icon: IconBlock },
    { href: `${base}/money`, label: "Money", icon: IconMoney },
    { href: `${base}/tent`, label: "Tent", icon: IconTent },
  ];

  return (
    <div className="min-h-dvh pb-28">
      <DemoBar />
      <header className="sticky top-0 z-30 border-b border-line/70 bg-paper/85 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/" className="flex min-w-0 items-center gap-2" aria-label="All groups">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-ink/70 text-sm">←</span>
            <span className="truncate text-[17px] font-semibold tracking-tight">{bundle.group.name}</span>
          </Link>
          <div className="flex shrink-0 items-center gap-2">
            {phase && <TentBadge type={phase} label={badgeLabel(bundle.group.settings, phase)} className="hidden min-[400px]:inline-flex" />}
            <Link href="/profile" aria-label="Profile">
              <Avatar id={me.user_id} name={profile?.display_name ?? me.profile.display_name} size={32} />
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 pt-5">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(10px,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-md items-center justify-between rounded-full border border-ink/80 bg-card/95 p-1.5 shadow-[0_8px_30px_rgba(28,28,26,0.12)] backdrop-blur">
          {tabs.map((t) => {
            const active = t.href === base ? path === base : path.startsWith(t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                className={`relative flex flex-1 flex-col items-center gap-0.5 rounded-full py-2 text-[10.5px] font-semibold transition ${active ? "bg-ink text-paper" : "text-ink-2"}`}
              >
                <t.icon active={active} />
                {t.label}
                {!!t.badge && (
                  <span className="absolute right-2 top-1 flex size-4 items-center justify-center rounded-full bg-coral font-mono text-[10px] text-ink">{t.badge}</span>
                )}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

type IP = { active: boolean };
const sw = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
function IconNow({ active }: IP) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="8.5" {...sw} />
      <path d="M12 7.5V12l3 2" {...sw} />
      {active && <circle cx="12" cy="12" r="2" fill="#c4f041" />}
    </svg>
  );
}
function IconCal({ active }: IP) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
      <rect x="3.5" y="5" width="17" height="15" rx="3" {...sw} />
      <path d="M3.5 10h17M8 3v4M16 3v4" {...sw} />
      {active && <rect x="13" y="13" width="4" height="4" rx="1" fill="#c4f041" />}
    </svg>
  );
}
function IconBlock({ active }: IP) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
      <rect x="4" y="4" width="16" height="16" rx="4" {...sw} />
      <path d="M8 16 16 8" {...sw} />
      {active && <circle cx="16" cy="16" r="2" fill="#c4f041" />}
    </svg>
  );
}
function IconMoney({ active }: IP) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
      <rect x="3" y="6" width="18" height="12" rx="3" {...sw} />
      <circle cx="12" cy="12" r="2.6" {...sw} fill={active ? "#c4f041" : "none"} />
    </svg>
  );
}
function IconTent({ active }: IP) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
      <path d="M12 3.5 3 20h18z" {...sw} />
      <path d="M12 11l-3 9h6z" fill={active ? "#c4f041" : "currentColor"} />
    </svg>
  );
}
