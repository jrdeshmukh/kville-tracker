"use client";
import { DateTime } from "luxon";
import { useEffect, useMemo, useState } from "react";
import { useGroup, useSession } from "@/lib/data/client";
import { fmtDay, fmtRange, fmtTime, hoursBetween } from "@/lib/defaults";
import { computeLoads, regenerate, timelineFor, type SlotView } from "@/lib/groupLogic";
import { rankReplacements, shiftMeta } from "@/lib/scheduler";
import type { Shift } from "@/lib/types";
import { Avatar, Moon, Sheet, Sun } from "./ui";

// ---------------------------------------------------------------- fairness chart

export function FairnessChart({ compact = false }: { compact?: boolean }) {
  const { bundle, me, memberName } = useGroup();
  const loads = useMemo(() => computeLoads(bundle).sort((a, b) => b.total - a.total), [bundle]);
  const max = Math.max(1, ...loads.map((l) => l.total));
  const avg = loads.reduce((a, l) => a + l.total, 0) / Math.max(1, loads.length);
  const spread = loads.length ? loads[0].total - loads[loads.length - 1].total : 0;
  const shown = compact ? loads.slice(0, 12) : loads;
  if (!bundle.shifts.length) return null;
  return (
    <div className="card p-4">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <p className="text-[15px] font-semibold">Weighted hours</p>
          <p className="text-[12px] text-ink-2">
            avg <b className="font-mono">{avg.toFixed(1)}</b> · spread <b className="font-mono">{spread.toFixed(1)}</b>
          </p>
        </div>
        <div className="flex items-center gap-3 font-mono text-[10.5px] text-ink-2">
          <span className="flex items-center gap-1"><i className="inline-block size-2.5 rounded-full bg-ink" />done</span>
          <span className="flex items-center gap-1"><i className="inline-block size-2.5 rounded-full bg-lime" />upcoming</span>
        </div>
      </div>
      <div className="space-y-2">
        {shown.map((l) => (
          <div key={l.userId} className="grid grid-cols-[88px_1fr_44px] items-center gap-2">
            <span className={`truncate text-[13px] ${l.userId === me.user_id ? "font-bold" : "text-ink-2"}`}>
              {l.userId === me.user_id ? "You" : memberName(l.userId).split(" ")[0]}
            </span>
            <div className="relative h-5 overflow-hidden rounded-full bg-line-2">
              <div className="absolute inset-y-0 left-0 rounded-full bg-lime" style={{ width: `${(l.total / max) * 100}%` }} />
              <div className="absolute inset-y-0 left-0 rounded-full bg-ink" style={{ width: `${(l.done / max) * 100}%` }} />
              <div className="absolute inset-y-0 w-px bg-coral" style={{ left: `${(avg / max) * 100}%` }} title="average" />
            </div>
            <span className="text-right font-mono text-[12px]">{l.total.toFixed(0)}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 font-mono text-[10.5px] text-muted">
        coral line = group average · nights count {bundle.group.settings.weights.weeknight}× · cold nights {bundle.group.settings.weights.harsh}×
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- segment card

export function SlotCard({ slot, onOpen, highlight }: { slot: SlotView; onOpen: () => void; highlight?: string }) {
  const { memberName } = useGroup();
  const now = Date.now();
  const live = Date.parse(slot.start) <= now && now < Date.parse(slot.end);
  const past = Date.parse(slot.end) <= now;
  const mine = highlight && slot.shifts.some((s) => s.user_id === highlight);
  const short = slot.required > 0 && slot.shifts.length < slot.required;
  return (
    <button
      onClick={onOpen}
      className={`card flex w-full items-start gap-3 p-3.5 text-left transition hover:border-ink ${past ? "opacity-55" : ""} ${mine ? "!border-ink ring-1 ring-ink" : ""} ${slot.isNight ? "!bg-ink text-paper" : ""}`}
    >
      <span className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full ${slot.isNight ? "bg-paper/10 text-sky" : "bg-lime-soft text-ink"}`}>
        {slot.isNight ? <Moon /> : <Sun />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="font-semibold">{fmtRange(slot.start, slot.end)}</p>
          <span className="flex items-center gap-1.5">
            {live && <span className="rounded-full bg-coral px-2 py-0.5 font-mono text-[10px] font-bold text-ink">LIVE</span>}
            {slot.required > 0 && (
              <span className={`rounded-full px-2 py-0.5 font-mono text-[11px] ${short ? "bg-danger font-bold text-paper" : slot.isNight ? "text-paper/60" : "text-muted"}`}>
                {slot.shifts.length}/{slot.required}
              </span>
            )}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {slot.shifts.map((s) => {
            const partial = s.start !== slot.start || s.end !== slot.end;
            return (
              <span
                key={s.id}
                className={`inline-flex items-center gap-1 rounded-full py-0.5 pl-0.5 pr-2.5 text-[12.5px] font-medium ${slot.isNight ? "bg-paper/10" : "bg-paper"} ${s.user_id === highlight ? "!bg-lime !text-ink" : ""}`}
              >
                <Avatar id={s.user_id} name={memberName(s.user_id)} size={20} />
                {memberName(s.user_id).split(" ")[0]}
                {partial && <span className="font-mono text-[10px] opacity-60">{fmtTime(s.start)}–{fmtTime(s.end)}</span>}
                {s.checked_in_at && <span title="Checked in">✓</span>}
                {s.source !== "auto" && <span className="opacity-50" title={s.source === "swap" ? "Swapped in" : "Manually added"}>{s.source === "swap" ? "⇄" : "✎"}</span>}
              </span>
            );
          })}
        </div>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------- slot sheet (details, replacement, admin edit)

export function SlotSheet({ slot, onClose }: { slot: SlotView | null; onClose: () => void }) {
  const { bundle, me, isAdmin, memberName, run } = useGroup();
  const { api } = useSession();
  const [replacing, setReplacing] = useState<Shift | null>(null);
  const [adding, setAdding] = useState("");
  useEffect(() => setReplacing(null), [slot?.key]);
  if (!slot) return null;
  const now = Date.now();
  // live shift objects (bundle may have refreshed)
  const shifts = bundle.shifts.filter((s) => Date.parse(s.start) < Date.parse(slot.end) && Date.parse(slot.start) < Date.parse(s.end));
  const inSlot = new Set(shifts.map((s) => s.user_id));
  const meta = shiftMeta(timelineFor(bundle), bundle.group.settings, slot.start, slot.end);

  return (
    <Sheet open={!!slot} onClose={onClose} title={`${fmtDay(slot.start)} · ${fmtRange(slot.start, slot.end)}`}>
      {replacing ? (
        <ReplacementList shift={replacing} onDone={() => setReplacing(null)} />
      ) : (
        <div className="space-y-2">
          <p className="mb-3 text-[14px] text-ink-2">
            {slot.isNight ? "Night" : "Day"} · {Math.round(hoursBetween(slot.start, slot.end) * 100) / 100}h
            {slot.required > 0 && ` · ${slot.required} needed, ${shifts.length} on`}
          </p>
          {shifts.map((s) => {
            const pending = bundle.swaps.filter((w) => w.shift_id === s.id && w.status === "pending");
            const over = Date.parse(s.end) <= now;
            return (
              <div key={s.id} className="card flex items-center gap-3 p-3">
                <Avatar id={s.user_id} name={memberName(s.user_id)} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">
                    {memberName(s.user_id)} {s.user_id === me.user_id && <span className="text-ink-2">(you)</span>}
                  </p>
                  <p className="text-[12px] text-ink-2">
                    <b className="font-mono font-medium text-ink">{fmtRange(s.start, s.end)}</b> ·{" "}
                    {s.checked_in_at ? "✓ checked in" : Date.parse(s.start) <= now ? "not checked in" : s.source === "swap" ? "swapped in" : s.source === "manual" ? "added manually" : "auto"}
                    {pending.length > 0 && ` · asked ${pending.map((p) => memberName(p.to_user).split(" ")[0]).join(", ")}`}
                  </p>
                </div>
                {!over && (s.user_id === me.user_id || isAdmin) && (
                  <button className="btn-ghost btn-sm" onClick={() => setReplacing(s)}>
                    {s.user_id === me.user_id ? "Can't make it" : "Replace"}
                  </button>
                )}
                {isAdmin && (
                  <button
                    className="rounded-full px-2.5 py-1.5 text-ink-2 hover:bg-coral-soft"
                    aria-label={`Remove ${memberName(s.user_id)} from shift`}
                    onClick={() => confirm(`Remove ${memberName(s.user_id)}'s ${fmtRange(s.start, s.end)} shift?`) && run(() => api.deleteShift(s.id), "Removed")}
                  >
                    ✕
                  </button>
                )}
              </div>
            );
          })}
          {isAdmin && (
            <div className="card mt-3 flex gap-2 p-3">
              <select className="input min-w-0 !py-2" value={adding} onChange={(e) => setAdding(e.target.value)} aria-label="Add person to this time">
                <option value="">Add someone {fmtRange(slot.start, slot.end)}…</option>
                {bundle.members
                  .filter((m) => !inSlot.has(m.user_id))
                  .map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.profile.display_name}
                    </option>
                  ))}
              </select>
              <button
                className="btn-primary btn-sm"
                disabled={!adding}
                onClick={async () => {
                  await run(
                    () => api.addShift(bundle.group.id, { start: slot.start, end: slot.end, user_id: adding, is_night: meta.isNight, weight: meta.weight, source: "manual" }),
                    "Added",
                  );
                  api.notify(bundle.group.id, [adding], "You were added to a shift", `${fmtDay(slot.start)} ${fmtRange(slot.start, slot.end)}`);
                  setAdding("");
                }}
              >
                Add
              </button>
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}

/** 15-minute options between two instants, as ISO strings. */
function quarterTimes(a: string, b: string) {
  const out: string[] = [];
  const step = 15 * 60_000;
  const start = Math.ceil(Date.parse(a) / step) * step;
  if (start !== Date.parse(a)) out.push(a);
  for (let t = start; t <= Date.parse(b); t += step) out.push(new Date(t).toISOString());
  if (Date.parse(out[out.length - 1]) !== Date.parse(b)) out.push(b);
  return out;
}

function ReplacementList({ shift, onDone }: { shift: Shift; onDone: () => void }) {
  const { bundle, me, isAdmin, memberName, run } = useGroup();
  const { api } = useSession();
  const earliest = new Date(Math.max(Date.parse(shift.start), Math.ceil(Date.now() / 900_000) * 900_000)).toISOString();
  const times = useMemo(() => quarterTimes(Date.parse(earliest) < Date.parse(shift.end) ? earliest : shift.start, shift.end), [earliest, shift.start, shift.end]);
  const [from, setFrom] = useState(times[0]);
  const [to, setTo] = useState(times[times.length - 1]);
  const whole = from === shift.start && to === shift.end;
  const range = { start: from, end: to, user_id: shift.user_id };
  const ranked = useMemo(
    () => rankReplacements(range, bundle.members.map((m) => m.user_id), bundle.shifts, bundle.availability),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [from, to, bundle],
  );
  const pendingTo = new Set(bundle.swaps.filter((w) => w.shift_id === shift.id && w.status === "pending").map((w) => w.to_user));
  const when = `${fmtDay(from)} ${fmtRange(from, to)}`;
  const part = whole ? undefined : { start: from, end: to };
  return (
    <div>
      <button className="mb-3 text-[14px] font-semibold underline underline-offset-4" onClick={onDone}>
        ← back
      </button>
      <div className="card mb-4 p-3">
        <p className="label">Which part can&apos;t {shift.user_id === me.user_id ? "you" : memberName(shift.user_id).split(" ")[0]} make?</p>
        <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <select className="input min-w-0 !py-2 font-mono" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From">
            {times.slice(0, -1).map((t) => (
              <option key={t} value={t} disabled={Date.parse(t) >= Date.parse(to)}>
                {fmtTime(t)}
              </option>
            ))}
          </select>
          <span className="text-muted">→</span>
          <select className="input min-w-0 !py-2 font-mono" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To">
            {times.slice(1).map((t) => (
              <option key={t} value={t} disabled={Date.parse(t) <= Date.parse(from)}>
                {fmtTime(t)}
              </option>
            ))}
          </select>
        </div>
        <p className="mt-2 text-[12px] text-ink-2">
          {whole ? "The whole shift." : `Only ${fmtRange(from, to)}; the rest stays with ${shift.user_id === me.user_id ? "you" : memberName(shift.user_id).split(" ")[0]}.`}
        </p>
      </div>
      <p className="mb-3 text-[14px] text-ink-2">
        Ranked by who&apos;s free then and who has the fewest weighted hours.{isAdmin && " As admin you can swap someone in right away."}
      </p>
      {ranked.length === 0 && (
        <p className="card p-4 text-ink-2">Nobody else can take this: everyone is either already in the tent then or blocked it off. Try a shorter piece, the group chat, or ask your admin.</p>
      )}
      <div className="space-y-2">
        {ranked.map((c, i) => (
          <div key={c.userId} className="card flex items-center gap-3 p-3">
            <span className="w-4 font-mono text-[12px] text-muted">{i + 1}</span>
            <Avatar id={c.userId} name={memberName(c.userId)} size={34} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{memberName(c.userId)}</p>
              <p className={`text-[12px] ${c.preferNot ? "text-coral" : "text-ink-2"}`}>{c.reasons.join(" · ")}</p>
            </div>
            {isAdmin ? (
              <button
                className="btn-primary btn-sm"
                onClick={async () => {
                  await run(() => api.reassignShift(shift.id, c.userId, part), `Swapped in ${memberName(c.userId).split(" ")[0]}`);
                  api.notify(bundle.group.id, [c.userId], "You've been swapped onto a shift", when);
                  api.notify(bundle.group.id, [shift.user_id], "You've been taken off a shift", when);
                  onDone();
                }}
              >
                Swap now
              </button>
            ) : (
              <button
                className="btn-primary btn-sm"
                disabled={pendingTo.has(c.userId)}
                onClick={async () => {
                  await run(() => api.requestSwap(bundle.group.id, shift.id, shift.user_id, c.userId, part), "Request sent");
                  api.notify(bundle.group.id, [c.userId], `${memberName(me.user_id).split(" ")[0]} needs a cover`, `Can you take ${when}?`);
                }}
              >
                {pendingTo.has(c.userId) ? "Asked" : "Ask"}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- manual shift form

export function ManualShiftSheet({ open, onClose, defaultDate }: { open: boolean; onClose: () => void; defaultDate?: string }) {
  const { bundle, run } = useGroup();
  const { api } = useSession();
  const s = bundle.group.settings;
  const [date, setDate] = useState(defaultDate ?? DateTime.now().setZone(s.timezone).toISODate()!);
  const [from, setFrom] = useState("09:00");
  const [to, setTo] = useState("10:30");
  const [who, setWho] = useState<string[]>([]);
  const [regen, setRegen] = useState(true);
  useEffect(() => {
    if (open && defaultDate) setDate(defaultDate);
  }, [open, defaultDate]);

  const start = DateTime.fromISO(`${date}T${from}`, { zone: s.timezone });
  let end = DateTime.fromISO(`${date}T${to}`, { zone: s.timezone });
  if (end <= start) end = end.plus({ days: 1 });
  const valid = start.isValid && end.isValid;
  const hours = valid ? end.diff(start, "hours").hours : 0;
  const meta = useMemo(
    () => (valid ? shiftMeta(timelineFor(bundle), s, start.toUTC().toISO()!, end.toUTC().toISO()!) : { weight: 0, isNight: false }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bundle, date, from, to],
  );

  return (
    <Sheet open={open} onClose={onClose} title="Pin people to a time">
      <p className="mb-4 text-[14px] text-ink-2">
        Put specific people on a time (e.g. someone who wants a whole night, 11pm–7am). Pinned shifts never move, count toward their fair share, and
        everything else is scheduled around them.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <label className="col-span-2">
          <span className="label">Date</span>
          <input type="date" className="input mt-1 min-w-0" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="min-w-0">
          <span className="label">From</span>
          <input type="time" step={300} className="input mt-1 min-w-0" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="min-w-0">
          <span className="label">To</span>
          <input type="time" step={300} className="input mt-1 min-w-0" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      <p className="mt-2 font-mono text-[12px] text-ink-2">
        {hours.toFixed(2).replace(/\.?0+$/, "")}h · {meta.weight} pts · {meta.isNight ? "night" : "day"}
        {end.day !== start.day && " · ends next day"}
      </p>
      <p className="label mt-4">Who</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {bundle.members.map((m) => {
          const on = who.includes(m.user_id);
          return (
            <button
              key={m.user_id}
              onClick={() => setWho((w) => (on ? w.filter((x) => x !== m.user_id) : [...w, m.user_id]))}
              className={`chip ${on ? "!border-ink !bg-lime" : ""}`}
            >
              <Avatar id={m.user_id} name={m.profile.display_name} size={18} />
              {m.profile.display_name.split(" ")[0]}
            </button>
          );
        })}
      </div>
      <label className="mt-4 flex items-center gap-2 text-[14px]">
        <input type="checkbox" checked={regen} onChange={(e) => setRegen(e.target.checked)} />
        Regenerate the rest of the schedule around this
      </label>
      <button
        className="btn-primary mt-4 w-full"
        disabled={!who.length || hours <= 0 || hours > 24}
        onClick={async () => {
          await run(async () => {
            for (const u of who)
              await api.addShift(bundle.group.id, { start: start.toUTC().toISO()!, end: end.toUTC().toISO()!, user_id: u, is_night: meta.isNight, weight: meta.weight, source: "manual" });
            if (regen) await regenerate(api, await api.getBundle(bundle.group.id));
          }, regen ? "Pinned and regenerated" : `Pinned ${who.length} ${who.length > 1 ? "people" : "person"}`);
          setWho([]);
          onClose();
        }}
      >
        {regen ? "Pin & regenerate" : "Pin"}
      </button>
    </Sheet>
  );
}
