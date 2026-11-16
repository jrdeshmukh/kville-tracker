"use client";
import { DateTime } from "luxon";
import { useEffect, useMemo, useRef, useState } from "react";
import { SlotSheet } from "@/components/schedule";
import { Avatar, DayStrip, Section, Toggle } from "@/components/ui";
import { useGroup, useSession } from "@/lib/data/client";
import { fmtDay, fmtRange } from "@/lib/defaults";
import type { Range } from "@/lib/data/api";
import { conflictsFor, seasonDays, tentDayOf, tentDayRange, timelineFor, type SlotView } from "@/lib/groupLogic";
import { requiredAt } from "@/lib/scheduler";
import type { AvailabilityKind } from "@/lib/types";

type Paint = AvailabilityKind | "free";
const Q = 5 * 60_000; // storage resolution (exact enough for "class ends 10:50")
const PER_DAY = (24 * 60) / 5;
const HALF = 30 * 60_000; // grid resolution

export default function TimesPage() {
  const { bundle, me, run } = useGroup();
  const { api } = useSession();
  const s = bundle.group.settings;
  const tz = s.timezone;
  const tl = useMemo(() => timelineFor(bundle), [bundle]);

  // ---- my availability as a map of 15-minute keys
  const initial = useMemo(() => {
    const m = new Map<number, AvailabilityKind>();
    for (const a of bundle.availability.filter((x) => x.user_id === me.user_id)) {
      for (let t = Math.floor(Date.parse(a.start) / Q) * Q; t < Date.parse(a.end); t += Q) m.set(t, a.kind);
    }
    return m;
  }, [bundle.availability, me.user_id]);
  const [marks, setMarks] = useState(initial);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) setMarks(initial);
  }, [initial, dirty]);

  const days = useMemo(() => seasonDays(s), [s]);
  const today = tentDayOf(s, new Date().toISOString()).toISODate()!;
  const [day, setDay] = useState(days.includes(today) ? today : days[0]);
  const [paint, setPaint] = useState<Paint>("unavailable");

  const range = day ? tentDayRange(s, day) : null;
  const hoursOf = (d: string) => {
    const r = tentDayRange(s, d);
    return Array.from({ length: 24 }, (_, i) => r.start.plus({ hours: i }));
  };

  const setRange = (from: number, to: number, kind: Paint) => {
    setMarks((prev) => {
      const m = new Map(prev);
      for (let t = from; t < to; t += Q) {
        if (kind === "free") m.delete(t);
        else m.set(t, kind);
      }
      return m;
    });
    setDirty(true);
  };

  // ---- drag painting on half-hour cells
  const painting = useRef<Paint | null>(null);
  const cellAt = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const k = el?.closest("[data-half]")?.getAttribute("data-half");
    return k ? Number(k) : null;
  };
  /** majority state of a half-hour cell, and whether it's only partly covered */
  const halfInfo = (k: number) => {
    const counts: Record<Paint, number> = { unavailable: 0, prefer_not: 0, free: 0 };
    for (let t = k; t < k + HALF; t += Q) counts[marks.get(t) ?? "free"]++;
    const st: Paint = counts.unavailable ? "unavailable" : counts.prefer_not ? "prefer_not" : "free";
    return { st, partial: st !== "free" && counts.free > 0 };
  };
  const halfState = (k: number): Paint => halfInfo(k).st;
  const onDown = (e: React.PointerEvent) => {
    const k = cellAt(e.clientX, e.clientY);
    if (k === null) return;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    painting.current = halfState(k) === paint ? "free" : paint;
    setRange(k, k + HALF, painting.current);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!painting.current) return;
    const k = cellAt(e.clientX, e.clientY);
    if (k !== null && (marks.get(k) ?? "free") !== painting.current) setRange(k, k + HALF, painting.current);
  };
  const onUp = () => (painting.current = null);

  // ---- exact time entry
  const [exFrom, setExFrom] = useState("09:00");
  const [exTo, setExTo] = useState("10:50");
  const [exKind, setExKind] = useState<AvailabilityKind>("unavailable");
  const addExact = () => {
    if (!day) return;
    let a = DateTime.fromISO(`${day}T${exFrom}`, { zone: tz });
    let b = DateTime.fromISO(`${day}T${exTo}`, { zone: tz });
    if (!a.isValid || !b.isValid) return;
    // times before the tent day starts (e.g. 2am) belong to the next calendar day
    if (range && a < range.start) a = a.plus({ days: 1 });
    if (b <= a) b = b.plus({ days: 1 });
    // round outward to the 5-minute grid so the whole class is covered
    const from = Math.floor(a.toMillis() / Q) * Q;
    const to = Math.ceil(b.toMillis() / Q) * Q;
    setRange(from, to, exKind);
  };

  // ---- stats & save
  const blockedHours = Math.round(([...marks.values()].filter((k) => k === "unavailable").length * 5) / 6) / 10;

  const toRanges = (keys: number[]): Range[] => {
    const out: Range[] = [];
    for (const k of keys.sort((a, b) => a - b)) {
      const kind = marks.get(k)!;
      const last = out[out.length - 1];
      if (last && Date.parse(last.end) === k && last.kind === kind) last.end = new Date(k + Q).toISOString();
      else out.push({ start: new Date(k).toISOString(), end: new Date(k + Q).toISOString(), kind });
    }
    return out;
  };

  const save = async () => {
    await run(() => api.replaceMyAvailability(bundle.group.id, toRanges([...marks.keys()])), "Saved");
    setDirty(false);
  };

  const copyTo = (target: "week" | "weekdays") => {
    if (!day) return;
    const src = tentDayRange(s, day).start.toMillis();
    const srcDow = DateTime.fromISO(day, { zone: tz }).weekday;
    setMarks((prev) => {
      const m = new Map(prev);
      for (const d of days) {
        if (d === day) continue;
        const dow = DateTime.fromISO(d, { zone: tz }).weekday;
        if (target === "week" && dow !== srcDow) continue;
        if (target === "weekdays" && dow > 5) continue;
        const dst = tentDayRange(s, d).start;
        for (let i = 0; i < PER_DAY; i++) {
          // use wall-clock offsets so DST days still line up
          const k = dst.plus({ minutes: i * 5 }).toMillis();
          const v = prev.get(DateTime.fromMillis(src, { zone: tz }).plus({ minutes: i * 5 }).toMillis());
          if (v) m.set(k, v);
          else m.delete(k);
        }
      }
      return m;
    });
    setDirty(true);
  };

  const dayBlocks = useMemo(() => {
    if (!range) return [];
    const a = range.start.toMillis(), b = range.end.toMillis();
    return toRanges([...marks.keys()].filter((k) => k >= a && k < b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marks, day]);

  const conflicts = conflictsFor(bundle, me.user_id);
  const [open, setOpen] = useState<SlotView | null>(null);
  const myBuddies = new Set(bundle.buddies.filter((b) => b.user_id === me.user_id).map((b) => b.buddy_id));
  const dayHours = day ? hoursOf(day) : [];
  const rows = [dayHours.slice(0, 6), dayHours.slice(6, 12), dayHours.slice(12, 18), dayHours.slice(18, 24)];
  const color: Record<Paint, string> = { unavailable: "bg-coral", prefer_not: "bg-peach", free: "" };

  return (
    <div className="space-y-6 pb-16">
      <div className="rise">
        <h1 className="h-display text-[40px]">My times</h1>
        <p className="mt-1 text-[15px] text-ink-2">Block out times you can&apos;t come. Drag across half-hours, or type exact times below.</p>
      </div>

      {conflicts.length > 0 && (
        <div className="rounded-[24px] bg-coral-soft p-4">
          <p className="font-semibold">You blocked time you&apos;re already scheduled for</p>
          <div className="mt-2 space-y-1.5">
            {conflicts.slice(0, 5).map((c) => (
              <button
                key={c.id}
                className="flex w-full items-center justify-between rounded-full bg-card px-4 py-2 text-left text-[14px]"
                onClick={() => setOpen({ key: c.id, start: c.start, end: c.end, isNight: c.is_night, required: 0, shifts: [c] })}
              >
                <span>
                  {fmtDay(c.start)} · {fmtRange(c.start, c.end)}
                </span>
                <span className="font-semibold">Find cover →</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="card rise p-4 text-[14px]">
        Can&apos;t-come hours: <b className="font-mono">{blockedHours}</b>
      </div>

      <div className="flex gap-2">
        {(
          [
            ["unavailable", "Can't come", "bg-coral"],
            ["prefer_not", "Prefer not", "bg-peach"],
            ["free", "Free", "bg-card"],
          ] as [Paint, string, string][]
        ).map(([k, label, c]) => (
          <button
            key={k}
            onClick={() => setPaint(k)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-full border py-2.5 text-[14px] font-semibold transition ${paint === k ? "border-ink ring-2 ring-ink" : "border-line"} ${c}`}
          >
            {label}
          </button>
        ))}
      </div>

      {days.length > 0 && (
        <DayStrip
          days={days}
          value={day}
          onChange={setDay}
          tz={tz}
          today={today}
          bar={(d) => {
            const r = tentDayRange(s, d);
            let blocked = 0, pref = 0;
            for (let t = r.start.toMillis(); t < r.end.toMillis(); t += Q) {
              const v = marks.get(t);
              if (v === "unavailable") blocked++;
              else if (v === "prefer_not") pref++;
            }
            return (
              <span className="mt-1 flex h-1.5 w-7 overflow-hidden rounded-full bg-line-2">
                <span className="bg-coral" style={{ width: `${(blocked / PER_DAY) * 100}%` }} />
                <span className="bg-peach" style={{ width: `${(pref / PER_DAY) * 100}%` }} />
              </span>
            );
          }}
        />
      )}

      {day && (
        <Section title={`${DateTime.fromISO(day, { zone: tz }).toFormat("cccc, LLL d")} → next morning`}>
          <div
            className="card select-none p-3"
            style={{ touchAction: "none" }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onPointerLeave={onUp}
          >
            <div className="grid gap-1.5">
              {rows.map((row, ri) => (
                <div key={ri} className="grid grid-cols-6 gap-1.5">
                  {row.map((h) => {
                    const k = h.toMillis();
                    const r = requiredAt(tl, h.toUTC().toISO()!);
                    const inSeason = r.tent !== null;
                    const night = r.tent !== null ? r.night : false;
                    return (
                      <div
                        key={k}
                        className={`relative flex h-12 overflow-hidden rounded-2xl border ${night ? "border-ink bg-ink text-paper" : "border-line bg-paper"} ${inSeason ? "" : "opacity-35"}`}
                      >
                        {[k, k + HALF].map((half) => {
                          const { st, partial } = halfInfo(half);
                          return (
                            <div
                              key={half}
                              data-half={half}
                              role="button"
                              aria-label={`${DateTime.fromMillis(half, { zone: tz }).toFormat("h:mma")} ${st.replace("_", " ")}`}
                              className={`flex-1 cursor-pointer ${st !== "free" ? color[st] : ""} ${partial ? "opacity-60" : ""} ${half !== k ? "border-l border-dashed border-ink/20" : ""}`}
                            />
                          );
                        })}
                        <span
                          className={`pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-[13px] font-semibold ${
                            halfState(k) !== "free" || halfState(k + HALF) !== "free" ? "text-ink" : ""
                          }`}
                        >
                          {h.toFormat("ha").toLowerCase()}
                          <span className="font-mono text-[9px] font-normal opacity-70">{night ? "night" : ""}</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            <p className="mt-2 text-center font-mono text-[10px] text-muted">each hour = two half-hours · tap or drag</p>
          </div>

          <div className="card mt-3 p-3">
            <p className="label">Exact times</p>
            <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              <input type="time" step={300} className="input min-w-0 !py-2" value={exFrom} onChange={(e) => setExFrom(e.target.value)} aria-label="Blocked from" />
              <span className="text-muted">→</span>
              <input type="time" step={300} className="input min-w-0 !py-2" value={exTo} onChange={(e) => setExTo(e.target.value)} aria-label="Blocked until" />
            </div>
            <div className="mt-2 flex gap-2">
              <select className="input min-w-0 flex-1 !py-2" value={exKind} onChange={(e) => setExKind(e.target.value as AvailabilityKind)} aria-label="Block type">
                <option value="unavailable">Can&apos;t come</option>
                <option value="prefer_not">Prefer not</option>
              </select>
              <button className="btn-primary btn-sm" onClick={addExact}>
                Add block
              </button>
            </div>
          </div>

          {dayBlocks.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {dayBlocks.map((b) => (
                <div key={b.start} className={`flex items-center justify-between rounded-full px-4 py-2 text-[14px] ${b.kind === "unavailable" ? "bg-coral" : "bg-peach"}`}>
                  <span>
                    <b className="font-mono font-semibold">{fmtRange(b.start, b.end)}</b> · {b.kind === "unavailable" ? "can't come" : "prefer not"}
                  </span>
                  <button aria-label="Remove block" className="font-bold" onClick={() => setRange(Date.parse(b.start), Date.parse(b.end), "free")}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <button className="chip" onClick={() => range && setRange(range.start.toMillis(), range.end.toMillis(), paint)}>
              Fill whole day
            </button>
            <button className="chip" onClick={() => range && setRange(range.start.toMillis(), range.end.toMillis(), "free")}>
              Clear day
            </button>
            <button className="chip" onClick={() => copyTo("week")}>
              Repeat every {DateTime.fromISO(day, { zone: tz }).toFormat("cccc")}
            </button>
            <button className="chip" onClick={() => copyTo("weekdays")}>
              Copy to all weekdays
            </button>
          </div>
          <p className="mt-2 text-[12px] text-ink-2">Tip: set up your class schedule on one day, then &quot;Repeat every …&quot;.</p>
        </Section>
      )}

      <Section title="Night buddies" hint="People you'd like to share nights with. The scheduler tries, but fairness comes first.">
        <div className="flex flex-wrap gap-1.5">
          {bundle.members
            .filter((m) => m.user_id !== me.user_id)
            .map((m) => {
              const on = myBuddies.has(m.user_id);
              return (
                <button
                  key={m.user_id}
                  className={`chip ${on ? "!border-ink !bg-lime" : ""}`}
                  onClick={() => {
                    const next = new Set(myBuddies);
                    if (on) next.delete(m.user_id);
                    else next.add(m.user_id);
                    run(() => api.setBuddies(bundle.group.id, [...next]));
                  }}
                >
                  <Avatar id={m.user_id} name={m.profile.display_name} size={18} />
                  {m.profile.display_name.split(" ")[0]}
                </button>
              );
            })}
        </div>
      </Section>

      <div className="card flex items-center justify-between gap-3 p-4">
        <div>
          <p className="font-semibold">I&apos;m done entering my times</p>
          <p className="text-[13px] text-ink-2">Lets your captain know you&apos;re ready for the schedule.</p>
        </div>
        <Toggle
          label="Done entering times"
          checked={!!me.submitted_at}
          onChange={async (v) => {
            if (dirty) await save();
            await run(() => api.markSubmitted(bundle.group.id, v), v ? "Marked as done ✓" : undefined);
            if (v) {
              const others = bundle.members.filter((m) => m.user_id !== me.user_id && !m.submitted_at);
              if (others.length === 0) {
                const admins = bundle.members.filter((m) => m.role === "admin").map((m) => m.user_id);
                api.notify(bundle.group.id, admins, "Everyone's times are in", "Open the Schedule tab to generate the tent schedule.");
              }
            }
          }}
        />
      </div>

      {dirty && (
        <div className="fixed inset-x-0 bottom-[84px] z-40 px-4">
          <div className="mx-auto flex max-w-md items-center gap-2 rounded-full border border-ink bg-lime p-1.5 pl-5 shadow-lg">
            <span className="flex-1 text-[14px] font-semibold">Unsaved changes</span>
            <button
              className="btn-ghost btn-sm !border-ink/30"
              onClick={() => {
                setMarks(initial);
                setDirty(false);
              }}
            >
              Undo
            </button>
            <button className="btn-primary btn-sm" onClick={save}>
              Save
            </button>
          </div>
        </div>
      )}
      <SlotSheet slot={open} onClose={() => setOpen(null)} />
    </div>
  );
}
