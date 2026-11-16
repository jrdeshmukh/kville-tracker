"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { FairnessChart, SlotSheet } from "@/components/schedule";
import { Avatar, Moon, Section, Sheet, Sun, TentBadge } from "@/components/ui";
import { useGroup, useSession, useToast } from "@/lib/data/client";
import { fmtDay, fmtRange, relTime } from "@/lib/defaults";
import { badgeLabel, periodAt, timelineFor, type SlotView } from "@/lib/groupLogic";
import { requiredAt } from "@/lib/scheduler";
import { enablePush, pushSupported } from "@/lib/push";

export default function NowPage() {
  const { bundle, me, memberName, run, isAdmin } = useGroup();
  const { api } = useSession();
  const toast = useToast();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  const now = Date.now();
  const s = bundle.group.settings;
  const nowIso = new Date(now).toISOString();
  const phase = periodAt(s, nowIso);
  const [open, setOpen] = useState<SlotView | null>(null);
  const [alertOpen, setAlertOpen] = useState(false);
  const tl = useMemo(() => timelineFor(bundle), [bundle]);

  const onNow = bundle.shifts.filter((x) => Date.parse(x.start) <= now && now < Date.parse(x.end));
  const myLive = onNow.find((x) => x.user_id === me.user_id);
  const req = requiredAt(tl, nowIso);
  const required = req.required;
  const overlapping = (a: string, b: string) => bundle.shifts.filter((x) => Date.parse(x.start) < Date.parse(b) && Date.parse(a) < Date.parse(x.end));
  const nextMine = bundle.shifts.find((x) => x.user_id === me.user_id && Date.parse(x.start) > now);
  const nextSlot: SlotView | undefined = nextMine
    ? { key: nextMine.id, start: nextMine.start, end: nextMine.end, isNight: nextMine.is_night, required: 0, shifts: overlapping(nextMine.start, nextMine.end) }
    : undefined;
  const swapsForMe = bundle.swaps.filter((w) => w.status === "pending" && w.to_user === me.user_id);
  const recentAlert = bundle.alerts.find((a) => now - Date.parse(a.created_at) < 30 * 60_000);
  const nextUp = bundle.shifts.find((x) => Date.parse(x.start) > now);
  const nextChange = onNow.length ? Math.min(...onNow.map((x) => Date.parse(x.end))) : null;

  const [pushState, setPushState] = useState<"unknown" | "on" | "off">("unknown");
  useEffect(() => {
    if (!pushSupported()) return setPushState("off");
    setPushState(Notification.permission === "granted" ? "on" : "off");
  }, []);

  return (
    <div className="space-y-6">
      {recentAlert && (
        <div className="rise relative overflow-hidden rounded-[28px] bg-coral p-5">
          <p className="font-mono text-[11px] uppercase tracking-wider">🚨 Tent check · {relTime(recentAlert.created_at)}</p>
          <p className="mt-1 text-xl font-semibold tracking-tight">{recentAlert.message}</p>
          <p className="mt-1 text-[13px]">from {memberName(recentAlert.created_by)}</p>
        </div>
      )}

      {swapsForMe.map((w) => {
        const sh = bundle.shifts.find((x) => x.id === w.shift_id);
        if (!sh) return null;
        return (
          <div key={w.id} className="rise rounded-[28px] border border-ink bg-lime p-5">
            <p className="label !text-ink/60">Cover request</p>
            <p className="mt-1 text-lg font-semibold leading-snug">
              {memberName(w.from_user).split(" ")[0]} needs someone for {fmtDay(w.start ?? sh.start)}, {fmtRange(w.start ?? sh.start, w.end ?? sh.end)}
              {sh.is_night && " (night)"}
            </p>
            <div className="mt-4 flex gap-2">
              <button
                className="btn-primary flex-1"
                onClick={async () => {
                  await run(() => api.respondSwap(w.id, true), "You've got it. Shift added 🙌");
                  api.notify(bundle.group.id, [w.from_user], "Shift covered ✓", `${memberName(me.user_id)} took your ${fmtDay(sh.start)} shift`);
                }}
              >
                I&apos;ll take it
              </button>
              <button className="btn-ghost flex-1" onClick={() => run(() => api.respondSwap(w.id, false), "Declined")}>
                Can&apos;t
              </button>
            </div>
          </div>
        );
      })}

      {/* In the tent now */}
      <section className="rise overflow-hidden rounded-[28px] bg-ink p-5 text-paper">
        <div className="flex items-center justify-between">
          <p className="font-mono text-[11px] uppercase tracking-wider text-paper/60">In the tent now</p>
          {phase ? <TentBadge type={phase} label={badgeLabel(s, phase)} /> : <span className="font-mono text-[11px] text-paper/60">off-season</span>}
        </div>
        {onNow.length ? (
          <>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="h-display text-[64px]">{onNow.filter((x) => x.checked_in_at).length}</span>
              <span className="text-paper/70">
                / {onNow.length} checked in{required ? ` · ${required} required` : ""}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {onNow.map((x) => (
                <span key={x.id} className={`inline-flex items-center gap-1.5 rounded-full py-1 pl-1 pr-3 text-[13px] ${x.checked_in_at ? "bg-lime text-ink" : "bg-paper/10"}`}>
                  <Avatar id={x.user_id} name={memberName(x.user_id)} size={22} />
                  {x.user_id === me.user_id ? "You" : memberName(x.user_id).split(" ")[0]}
                  {x.checked_in_at ? " ✓" : ""}
                </span>
              ))}
            </div>
            <p className="mt-3 flex items-center gap-1.5 text-[13px] text-paper/60">
              {req.night ? <Moon size={12} /> : <Sun size={12} />}
              {nextChange && `next hand-off ${relTime(new Date(nextChange).toISOString())}`}
            </p>
            {myLive && !myLive.checked_in_at && (
              <button className="btn-lime mt-4 w-full" onClick={() => run(() => api.checkIn(myLive.id), "Checked in ✓")}>
                I&apos;m at the tent: check in
              </button>
            )}
          </>
        ) : (
          <p className="mt-3 text-lg text-paper/80">
            {bundle.shifts.length ? "Nobody's scheduled right now." : "No schedule yet."}
            {required > 0 && <span className="block text-[14px] text-coral">{required} should be here right now!</span>}
            {nextUp && <span className="block text-[14px] text-paper/60">Next shift {relTime(nextUp.start)}</span>}
          </p>
        )}
      </section>

      <button
        onClick={() => setAlertOpen(true)}
        className="rise flex w-full items-center justify-between rounded-full border-2 border-ink bg-coral px-6 py-4 text-left transition active:scale-[0.98]"
      >
        <span>
          <span className="block text-lg font-bold tracking-tight">Tent check alert</span>
          <span className="block text-[13px]">Ping everyone to get to the tent now</span>
        </span>
        <span className="text-3xl">🚨</span>
      </button>

      {/* my next shift */}
      <Section title="Your next shift">
        {nextMine && nextSlot ? (
          <button onClick={() => setOpen(nextSlot)} className="card flex w-full items-center gap-4 p-5 text-left transition hover:border-ink">
            <span className={`flex size-14 shrink-0 items-center justify-center rounded-full ${nextMine.is_night ? "bg-ink text-sky" : "bg-lime"}`}>
              {nextMine.is_night ? <Moon size={22} /> : <Sun size={22} />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-ink-2">{relTime(nextMine.start)}</p>
              <p className="text-xl font-semibold tracking-tight">{fmtDay(nextMine.start)}</p>
              <p className="text-ink-2">
                {fmtRange(nextMine.start, nextMine.end)} · with{" "}
                {[...new Set(nextSlot.shifts.filter((x) => x.user_id !== me.user_id).map((x) => memberName(x.user_id).split(" ")[0]))].join(", ") || "nobody else"}
              </p>
            </div>
            <span className="text-[13px] font-semibold underline underline-offset-4">Can&apos;t go?</span>
          </button>
        ) : (
          <div className="card p-5 text-ink-2">{bundle.group.published_at ? "Nothing coming up for you." : "The schedule hasn't been published yet."}</div>
        )}
      </Section>

      {!bundle.group.published_at && (
        <Section title="Getting ready" hint="Everyone enters their times, then the captain generates the schedule.">
          <div className="card divide-y divide-line">
            {bundle.members.map((m) => (
              <div key={m.user_id} className="flex items-center gap-3 px-4 py-2.5">
                <Avatar id={m.user_id} name={m.profile.display_name} size={28} />
                <span className="flex-1 text-[15px]">{m.profile.display_name}</span>
                <span className={`chip py-0.5 font-mono text-[11px] ${m.submitted_at ? "!bg-lime" : ""}`}>{m.submitted_at ? "READY" : "PENDING"}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <Link className="btn-primary flex-1" href={`/g/${bundle.group.id}/times`}>
              Enter my times
            </Link>
            {isAdmin && (
              <Link className="btn-ghost flex-1" href={`/g/${bundle.group.id}/schedule`}>
                Generate
              </Link>
            )}
          </div>
        </Section>
      )}

      {pushState === "off" && api.mode === "supabase" && (
        <div className="card flex items-center gap-3 p-4">
          <span className="text-2xl">🔔</span>
          <p className="flex-1 text-[14px]">Turn on notifications for shift reminders, cover requests and tent checks.</p>
          <button
            className="btn-primary btn-sm"
            onClick={() =>
              enablePush(api)
                .then(() => {
                  setPushState("on");
                  toast("Notifications on");
                })
                .catch((e) => toast(e.message, "error"))
            }
          >
            Turn on
          </button>
        </div>
      )}

      {bundle.shifts.length > 0 && (
        <Section title="Fairness so far">
          <FairnessChart compact />
        </Section>
      )}

      {bundle.alerts.length > 0 && (
        <Section title="Recent alerts">
          <div className="card divide-y divide-line">
            {bundle.alerts.slice(0, 5).map((a) => (
              <div key={a.id} className="px-4 py-3">
                <p className="text-[15px]">{a.message}</p>
                <p className="font-mono text-[11px] text-muted">
                  {memberName(a.created_by)} · {relTime(a.created_at)}
                </p>
              </div>
            ))}
          </div>
        </Section>
      )}

      <AlertSheet open={alertOpen} onClose={() => setAlertOpen(false)} />
      <SlotSheet slot={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function AlertSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { bundle, run } = useGroup();
  const { api } = useSession();
  const presets = ["TENT CHECK! Everyone get to the tent NOW", "Tent check in ~10 min, start heading over", "Line monitor walking around. Whoever's on, be in the tent"];
  const [msg, setMsg] = useState(presets[0]);
  return (
    <Sheet open={open} onClose={onClose} title="Send tent check alert">
      <p className="mb-3 text-[14px] text-ink-2">This sends a notification to all {bundle.members.length} members and shows a banner in the app.</p>
      <div className="space-y-2">
        {presets.map((p) => (
          <button key={p} onClick={() => setMsg(p)} className={`card w-full p-3 text-left text-[15px] ${msg === p ? "!border-ink ring-1 ring-ink" : ""}`}>
            {p}
          </button>
        ))}
        <textarea className="input min-h-20" value={msg} onChange={(e) => setMsg(e.target.value)} aria-label="Alert message" />
      </div>
      <button
        className="btn-danger mt-4 w-full !border-2 !border-ink"
        disabled={!msg.trim()}
        onClick={async () => {
          await run(() => api.sendAlert(bundle.group.id, msg.trim()), "Alert sent to everyone 🚨");
          onClose();
        }}
      >
        🚨 Send to everyone
      </button>
    </Sheet>
  );
}
