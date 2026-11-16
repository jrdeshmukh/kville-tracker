import { DateTime } from "luxon";
import type { DataApi } from "./data/api";
import { fractionLabel, TENT_INFO } from "./defaults";
import { buildTimeline, generateSchedule, requiredAt, type Timeline } from "./scheduler";
import type { GroupBundle, GroupSettings, Shift, TentType } from "./types";

export type BadgeKind = TentType | "game";

/** Which tent phase (or game tent) is running at an instant. */
export function periodAt(settings: GroupSettings, iso: string): BadgeKind | null {
  const tz = settings.timezone;
  if (settings.mode === "game") {
    const t = Date.parse(iso);
    const a = DateTime.fromISO(settings.game.start, { zone: tz }).toMillis();
    const b = DateTime.fromISO(settings.game.end, { zone: tz }).toMillis();
    return t >= a && t < b ? "game" : null;
  }
  const d = DateTime.fromISO(iso, { zone: tz });
  const [h, m] = settings.nightEnd.split(":").map(Number);
  const day = d.hour * 60 + d.minute < h * 60 + (m || 0) ? d.minus({ days: 1 }) : d;
  const date = day.toISODate()!;
  return settings.phases.find((p) => p.start <= date && date <= p.end)?.type ?? null;
}

/** Badge to show for a group right now (falls back to the first phase / game). */
export function currentBadge(settings: GroupSettings): BadgeKind {
  return periodAt(settings, new Date().toISOString()) ?? (settings.mode === "game" ? "game" : settings.phases[0]?.type ?? "black");
}

export function badgeLabel(settings: GroupSettings, kind: BadgeKind) {
  if (kind === "game") return settings.game.opponent ? `vs ${settings.game.opponent}` : "Game tent";
  return `${TENT_INFO[kind].label} tent`;
}

export function ruleSummary(settings: GroupSettings, memberCount: number) {
  if (settings.mode === "game") {
    const need = Math.max(1, Math.ceil(memberCount * settings.game.fraction - 1e-9));
    return `${fractionLabel(settings.game.fraction)} rule: ${need} of ${memberCount} in the tent at all times`;
  }
  return settings.phases.map((p) => `${TENT_INFO[p.type].label} ${settings.requirements[p.type].day}/${settings.requirements[p.type].night}`).join(" · ") + " (day/night)";
}

/** Start of the first tent day and end of the last, in the group's timezone. */
export function seasonBounds(settings: GroupSettings) {
  const tz = settings.timezone;
  if (settings.mode === "game") {
    const a = DateTime.fromISO(settings.game.start, { zone: tz });
    const b = DateTime.fromISO(settings.game.end, { zone: tz });
    return { start: tentDayOf(settings, a.toUTC().toISO()!), end: tentDayOf(settings, b.minus({ minutes: 1 }).toUTC().toISO()!).plus({ days: 1 }) };
  }
  const starts = settings.phases.map((p) => p.start).sort();
  const ends = settings.phases.map((p) => p.end).sort();
  return {
    start: DateTime.fromISO(starts[0], { zone: tz }).startOf("day"),
    end: DateTime.fromISO(ends[ends.length - 1], { zone: tz }).plus({ days: 1 }).startOf("day"),
  };
}

/** List of tent days (YYYY-MM-DD) in the season. */
export function seasonDays(settings: GroupSettings) {
  const { start, end } = seasonBounds(settings);
  const out: string[] = [];
  for (let d = start; d < end && out.length < 400; d = d.plus({ days: 1 })) out.push(d.toISODate()!);
  return out;
}

/** A "tent day" runs from night-end (7am) to the next morning's night-end. */
export function tentDayOf(settings: GroupSettings, iso: string) {
  const d = DateTime.fromISO(iso, { zone: settings.timezone });
  const [h, m] = settings.nightEnd.split(":").map(Number);
  const shifted = d.hour * 60 + d.minute < h * 60 + (m || 0) ? d.minus({ days: 1 }) : d;
  return shifted.startOf("day");
}
export function tentDayRange(settings: GroupSettings, date: string) {
  const [h, m] = settings.nightEnd.split(":").map(Number);
  const a = DateTime.fromISO(date, { zone: settings.timezone }).set({ hour: h || 0, minute: m || 0 });
  return { start: a, end: a.plus({ days: 1 }) };
}

export function timelineFor(bundle: GroupBundle): Timeline {
  return buildTimeline(bundle.group.settings, bundle.specials, bundle.members.length);
}

export interface Load {
  userId: string;
  done: number;
  upcoming: number;
  total: number;
  nights: number;
  hours: number;
}

export function computeLoads(bundle: GroupBundle, nowMs = Date.now()): Load[] {
  const map = new Map<string, Load>(
    bundle.members.map((m) => [m.user_id, { userId: m.user_id, done: 0, upcoming: 0, total: 0, nights: 0, hours: 0 }]),
  );
  for (const s of bundle.shifts) {
    const l = map.get(s.user_id);
    if (!l) continue;
    const w = Number(s.weight) || 0;
    const a = Date.parse(s.start), b = Date.parse(s.end);
    // split in-progress shifts proportionally
    const doneFrac = b <= nowMs ? 1 : a >= nowMs ? 0 : (nowMs - a) / (b - a);
    l.done += w * doneFrac;
    l.upcoming += w * (1 - doneFrac);
    l.total += w;
    l.hours += (b - a) / 3.6e6;
    if (s.is_night) l.nights++;
  }
  return [...map.values()].map((l) => ({ ...l, done: r1(l.done), upcoming: r1(l.upcoming), total: r1(l.total), hours: r1(l.hours) }));
}
const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * A stretch of time where the same people are in the tent. Shifts have flexible lengths, so a
 * day is shown as consecutive segments that change whenever someone starts or leaves.
 */
export interface SlotView {
  key: string;
  start: string;
  end: string;
  isNight: boolean;
  required: number;
  shifts: Shift[];
}

export function segmentsBetween(
  allShifts: Shift[],
  fromMs: number,
  toMs: number,
  tl: Timeline | null,
  onlyUser?: string,
): SlotView[] {
  const inRange = allShifts.filter((s) => Date.parse(s.start) < toMs && fromMs < Date.parse(s.end));
  const pts = new Set<number>();
  for (const s of inRange) {
    pts.add(Math.max(fromMs, Date.parse(s.start)));
    pts.add(Math.min(toMs, Date.parse(s.end)));
  }
  const times = [...pts].sort((a, b) => a - b);
  const out: SlotView[] = [];
  for (let i = 0; i + 1 < times.length; i++) {
    const a = times[i], b = times[i + 1];
    const on = inRange.filter((s) => Date.parse(s.start) <= a && b <= Date.parse(s.end));
    if (!on.length) continue;
    if (onlyUser && !on.some((s) => s.user_id === onlyUser)) continue;
    const ids = on.map((s) => s.id).sort().join(",");
    const last = out[out.length - 1];
    if (last && Date.parse(last.end) === a && last.shifts.map((s) => s.id).sort().join(",") === ids) {
      last.end = new Date(b).toISOString();
      continue;
    }
    const iso = new Date(a).toISOString();
    const req = tl ? requiredAt(tl, iso) : null;
    out.push({
      key: `${a}`,
      start: iso,
      end: new Date(b).toISOString(),
      isNight: req ? req.night : on.some((s) => s.is_night),
      required: req?.required ?? 0,
      shifts: on.sort((x, y) => x.start.localeCompare(y.start)),
    });
  }
  return out;
}

/** Regenerate every future (not yet started, auto) shift. */
export async function regenerate(api: DataApi, bundle: GroupBundle) {
  const now = new Date().toISOString();
  const res = generateSchedule({
    settings: bundle.group.settings,
    memberIds: bundle.members.map((m) => m.user_id),
    availability: bundle.availability,
    specials: bundle.specials,
    buddies: bundle.buddies,
    existing: bundle.shifts,
    now,
  });
  await api.replaceFutureShifts(bundle.group.id, now, res.shifts);
  return res;
}

/** Future shifts of `userId` that collide with their own can't-come blocks. */
export function conflictsFor(bundle: GroupBundle, userId: string) {
  const now = Date.now();
  const blocks = bundle.availability.filter((a) => a.user_id === userId && a.kind === "unavailable");
  return bundle.shifts.filter(
    (s) =>
      s.user_id === userId &&
      Date.parse(s.start) > now &&
      blocks.some((b) => Date.parse(b.start) < Date.parse(s.end) && Date.parse(s.start) < Date.parse(b.end)),
  );
}

export function balances(bundle: GroupBundle) {
  const owed = new Map<string, Map<string, number>>();
  for (const e of bundle.expenses)
    for (const s of e.shares) {
      if (s.paid_at || s.user_id === e.buyer_id) continue;
      if (!owed.has(s.user_id)) owed.set(s.user_id, new Map());
      const m = owed.get(s.user_id)!;
      m.set(e.buyer_id, (m.get(e.buyer_id) ?? 0) + s.amount_cents);
    }
  return owed;
}
