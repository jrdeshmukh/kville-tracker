"use client";
import { DateTime } from "luxon";
import { useMemo, useState } from "react";
import { FairnessChart, ManualShiftSheet, SlotCard, SlotSheet } from "@/components/schedule";
import { DayStrip, Empty, Section, Seg } from "@/components/ui";
import { useGroup, useSession } from "@/lib/data/client";
import { fmtDay, fmtRange, TENT_INFO } from "@/lib/defaults";
import { periodAt, regenerate, ruleSummary, seasonDays, segmentsBetween, tentDayOf, tentDayRange, timelineFor, type SlotView } from "@/lib/groupLogic";
import { downloadIcs } from "@/lib/ics";

export default function SchedulePage() {
  const { bundle, me, isAdmin, run } = useGroup();
  const { api } = useSession();
  const s = bundle.group.settings;
  const tz = s.timezone;
  const [view, setView] = useState<"all" | "mine">("all");
  const [open, setOpen] = useState<SlotView | null>(null);
  const [manual, setManual] = useState(false);
  const [problems, setProblems] = useState<{ start: string; end: string; missing: number }[] | null>(null);

  const days = useMemo(() => seasonDays(s), [s]);
  const today = tentDayOf(s, new Date().toISOString()).toISODate()!;
  const [day, setDay] = useState(days.includes(today) ? today : days[0]);
  const tl = useMemo(() => timelineFor(bundle), [bundle]);

  const daySegs = useMemo(() => {
    if (!day) return [];
    const r = tentDayRange(s, day);
    return segmentsBetween(bundle.shifts, r.start.toMillis(), r.end.toMillis(), tl, view === "mine" ? me.user_id : undefined);
  }, [bundle.shifts, day, view, tl, s, me.user_id]);
  const myDays = useMemo(() => new Set(bundle.shifts.filter((x) => x.user_id === me.user_id).map((x) => tentDayOf(s, x.start).toISODate()!)), [bundle.shifts, me.user_id, s]);

  const generate = async () => {
    const res = await run(() => regenerate(api, bundle));
    if (res) {
      setProblems(res.understaffed);
      if (!bundle.group.published_at) {
        await run(() => api.updateGroup(bundle.group.id, { published_at: new Date().toISOString() }), "Schedule published 🎉");
        api.notify(bundle.group.id, "all", "The tent schedule is live", "Open K-Ville Tracker to see your shifts.");
      } else api.notify(bundle.group.id, "all", "Schedule updated", "Upcoming shifts changed. Check yours.");
    }
  };

  const myUpcoming = bundle.shifts.filter((x) => x.user_id === me.user_id && Date.parse(x.end) > Date.now());
  const submitted = bundle.members.filter((m) => m.submitted_at).length;
  const maxNeeded = s.mode === "game" ? 1 : Math.max(...s.phases.map((p) => Math.max(s.requirements[p.type].day, s.requirements[p.type].night)));

  return (
    <div className="space-y-6">
      <div className="rise flex items-end justify-between gap-3">
        <h1 className="h-display text-[40px]">Schedule</h1>
        <Seg value={view} onChange={setView} options={[{ value: "all", label: "Everyone" }, { value: "mine", label: "Mine" }]} />
      </div>
      <p className="-mt-3 px-1 font-mono text-[11px] text-ink-2">{ruleSummary(s, bundle.members.length)}</p>

      {!bundle.group.published_at && (
        <div className="card rise p-5">
          <p className="label">Not published yet</p>
          <p className="mt-1 text-[15px]">
            <b>{submitted}</b> of {bundle.members.length} have finished entering their times.
          </p>
          {isAdmin ? (
            <>
              <p className="mt-1 text-[14px] text-ink-2">
                Generate once everyone is in. Shifts bend around everyone&apos;s blocked times (down to 15 min). You can regenerate later; past, manual and swapped
                shifts always stay put.
              </p>
              <button className="btn-lime mt-4 w-full" onClick={generate}>
                Generate & publish schedule
              </button>
            </>
          ) : (
            <p className="mt-1 text-[14px] text-ink-2">Your captain will publish the schedule once everyone has entered their times.</p>
          )}
        </div>
      )}

      {isAdmin && bundle.group.published_at && (
        <div className="rise flex flex-wrap gap-2">
          <button className="btn-ghost btn-sm" onClick={() => confirm("Regenerate all future shifts? Past, manual and swapped shifts stay put.") && generate()}>
            ↻ Regenerate future
          </button>
          <button className="btn-ghost btn-sm" onClick={() => setManual(true)}>
            📌 Pin people
          </button>
        </div>
      )}

      {problems && problems.length > 0 && (
        <div className="rounded-[24px] bg-coral-soft p-4 text-[14px]">
          <p className="font-semibold">{problems.length} stretches are short on people</p>
          <ul className="mt-1 space-y-0.5 font-mono text-[12px]">
            {problems.slice(0, 6).map((p) => (
              <li key={p.start}>
                {fmtDay(p.start)} {fmtRange(p.start, p.end)}: need {p.missing} more
              </li>
            ))}
          </ul>
          <p className="mt-2 text-ink-2">
            {bundle.members.length < maxNeeded
              ? `You have ${bundle.members.length} member${bundle.members.length === 1 ? "" : "s"}, but some shifts need more people than that. Invite the rest of your tent, then regenerate.`
              : "Too many people blocked these times. Ask people to free some up, or add shifts manually."}
          </p>
        </div>
      )}

      {days.length > 0 ? (
        <DayStrip
          days={days}
          value={day}
          onChange={setDay}
          tz={tz}
          today={today}
          marker={(d) => myDays.has(d)}
          bar={(d) => {
            const k = periodAt(s, DateTime.fromISO(d, { zone: tz }).set({ hour: 12 }).toUTC().toISO()!);
            return <span className="mt-1 h-1.5 w-5 rounded-full border border-ink/20" style={{ background: k ? TENT_INFO[k].color : "transparent" }} />;
          }}
        />
      ) : (
        <Empty>Set the tenting dates under Tent → Tent rules.</Empty>
      )}

      {day && (
        <Section title={`${DateTime.fromISO(day, { zone: tz }).toFormat("cccc, LLLL d")} → next morning`}>
          <div className="space-y-2">
            {daySegs.map((sl) => (
              <SlotCard key={sl.key} slot={sl} onOpen={() => setOpen(sl)} highlight={me.user_id} />
            ))}
            {daySegs.length === 0 && <Empty>{view === "mine" ? "You're free this day 🎉" : "No shifts on this day."}</Empty>}
          </div>
        </Section>
      )}

      <div className="rise flex flex-wrap items-center gap-2">
        <button className="btn-ghost btn-sm" disabled={!myUpcoming.length} onClick={() => downloadIcs(bundle.group.name, myUpcoming, s.reminderMinutes)}>
          ⬇ Export my {myUpcoming.length} shifts (.ics)
        </button>
        <span className="text-[12px] text-ink-2">Or subscribe from your profile for auto-updates.</span>
      </div>

      <Section title="Fairness">
        <FairnessChart />
      </Section>

      <SlotSheet slot={open} onClose={() => setOpen(null)} />
      {isAdmin && <ManualShiftSheet open={manual} onClose={() => setManual(false)} defaultDate={day} />}
    </div>
  );
}
