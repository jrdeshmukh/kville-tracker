import { DateTime } from "luxon";
import type { Availability, Buddy, GroupSettings, NewShift, Shift, SpecialPeriod, TentType } from "./types";

/**
 * K-Ville scheduler: flexible shifts on a 15-minute grid.
 *
 * 1. buildTimeline: turn the season into 15-minute units. Each unit knows how many people
 *    must be in the tent, whether it's night, and how "hard" an hour there counts.
 *    - Carolina mode: Black/Blue/White phases with day/night head counts.
 *    - Game mode: a fraction of the group (e.g. 1/3) at all times between start and end.
 *    - Grace periods need nobody; rough periods weigh extra.
 * 2. generateSchedule walks the timeline in order. Whenever the tent is short, it starts a
 *    shift for the best candidate (fewest weighted hours, free, not "prefer not") that runs
 *    until the target length *or until that person's own blocked time starts*, so a class
 *    ending at 10:30 simply means a hand-off at 10:30, not a lost 2-hour block.
 * 3. Local search then moves whole shifts between people and slides hand-off times in
 *    30-minute steps until weighted hours are as even as possible.
 *
 * Past/in-progress shifts, manual shifts and accepted swaps are locked and count toward totals.
 */

export const STEP_MIN = 15;
const STEP = STEP_MIN * 60_000;
const UNITS_PER_HOUR = 60 / STEP_MIN;

const PREFER_NOT_PENALTY = 6;
const BACK_TO_BACK_PENALTY = 4;
const CONSECUTIVE_NIGHT_PENALTY = 3;
const SHORT_SHIFT_PENALTY = 3;
const BUDDY_BONUS = 1.5;
const STABILITY_BONUS = 1;
const LAMBDA = 4;
const REST_UNITS = 2 * UNITS_PER_HOUR;

const ms = (iso: string) => Date.parse(iso);
const round2 = (n: number) => Math.round(n * 100) / 100;

function parseHM(hm: string) {
  const [h, m] = hm.split(":").map(Number);
  return { hour: h || 0, minute: m || 0 };
}

export interface Timeline {
  t0: number;
  n: number;
  required: Int16Array;
  night: Uint8Array;
  perHour: Float32Array;
  period: Int32Array;
  /** first unit index after i where the shift must end (period change or nobody needed) */
  segEnd: Int32Array;
  tent: (TentType | "game" | null)[];
}

interface Window {
  start: number;
  end: number;
  night: boolean;
  required: number;
  tent: TentType | "game";
  weekendNight: boolean;
}

/** Number of people the game-mode rule requires. */
export function gameRequired(settings: GroupSettings, memberCount: number) {
  if (memberCount <= 0) return 0;
  return Math.max(1, Math.ceil(memberCount * settings.game.fraction - 1e-9));
}

function windows(settings: GroupSettings, memberCount: number): Window[] {
  const tz = settings.timezone;
  const ns = parseHM(settings.nightStart);
  const ne = parseHM(settings.nightEnd);
  const out: Window[] = [];
  const dayPair = (d: DateTime) => {
    const dayStart = d.set(ne);
    const nightStart = d.set(ns);
    let nightEnd = d.plus({ days: 1 }).set(ne);
    if (nightEnd <= nightStart) nightEnd = nightEnd.plus({ days: 1 });
    return { dayStart, nightStart, nightEnd, weekend: d.weekday === 5 || d.weekday === 6 };
  };

  if (settings.mode === "game") {
    const gs = DateTime.fromISO(settings.game.start, { zone: tz });
    const ge = DateTime.fromISO(settings.game.end, { zone: tz });
    if (!gs.isValid || !ge.isValid || ge <= gs) return [];
    const req = gameRequired(settings, memberCount);
    for (let d = gs.startOf("day").minus({ days: 1 }); d <= ge; d = d.plus({ days: 1 })) {
      const p = dayPair(d);
      const parts: [DateTime, DateTime, boolean][] = [
        [p.dayStart, p.nightStart, false],
        [p.nightStart, p.nightEnd, true],
      ];
      for (const [a, b, night] of parts) {
        const s = Math.max(a.toMillis(), gs.toMillis());
        const e = Math.min(b.toMillis(), ge.toMillis());
        if (e > s) out.push({ start: s, end: e, night, required: req, tent: "game", weekendNight: p.weekend });
      }
    }
    return out;
  }

  for (const phase of settings.phases) {
    const req = settings.requirements[phase.type];
    let d = DateTime.fromISO(phase.start, { zone: tz }).startOf("day");
    const last = DateTime.fromISO(phase.end, { zone: tz }).startOf("day");
    while (d <= last) {
      const p = dayPair(d);
      out.push({ start: p.dayStart.toMillis(), end: p.nightStart.toMillis(), night: false, required: req.day, tent: phase.type, weekendNight: false });
      out.push({ start: p.nightStart.toMillis(), end: p.nightEnd.toMillis(), night: true, required: req.night, tent: phase.type, weekendNight: p.weekend });
      d = d.plus({ days: 1 });
    }
  }
  return out;
}

export function buildTimeline(settings: GroupSettings, specials: SpecialPeriod[], memberCount: number): Timeline {
  const ws = windows(settings, memberCount).filter((w) => w.end > w.start);
  const align = (t: number) => Math.floor(t / STEP) * STEP;
  if (!ws.length) {
    return { t0: 0, n: 0, required: new Int16Array(0), night: new Uint8Array(0), perHour: new Float32Array(0), period: new Int32Array(0), segEnd: new Int32Array(0), tent: [] };
  }
  const t0 = align(Math.min(...ws.map((w) => w.start)));
  const t1 = Math.ceil(Math.max(...ws.map((w) => w.end)) / STEP) * STEP;
  const n = Math.round((t1 - t0) / STEP);
  const required = new Int16Array(n);
  const night = new Uint8Array(n);
  const perHour = new Float32Array(n);
  const period = new Int32Array(n).fill(-1);
  const tent: Timeline["tent"] = new Array(n).fill(null);
  const w8 = settings.weights;

  ws.forEach((w, wi) => {
    const a = Math.max(0, Math.round((align(w.start) - t0) / STEP));
    const b = Math.min(n, Math.round((Math.ceil(w.end / STEP) * STEP - t0) / STEP));
    for (let u = a; u < b; u++) {
      required[u] = w.required;
      night[u] = w.night ? 1 : 0;
      perHour[u] = w.night ? (w.weekendNight ? w8.weekendNight : w8.weeknight) : w8.day;
      period[u] = wi;
      tent[u] = w.tent;
    }
  });

  for (const sp of specials) {
    const a = Math.max(0, Math.floor((ms(sp.start) - t0) / STEP));
    const b = Math.min(n, Math.ceil((ms(sp.end) - t0) / STEP));
    for (let u = a; u < b; u++) {
      if (sp.kind === "grace") required[u] = 0;
      else perHour[u] = Math.max(perHour[u], w8.harsh);
    }
  }

  const segEnd = new Int32Array(n);
  for (let i = n - 1; i >= 0; i--) {
    segEnd[i] = i + 1 < n && period[i + 1] === period[i] && required[i + 1] > 0 ? segEnd[i + 1] : i + 1;
  }
  return { t0, n, required, night, perHour, period, segEnd, tent };
}

/** Weight + night flag for an arbitrary time range (used for manual shifts and swaps). */
export function shiftMeta(tl: Timeline, settings: GroupSettings, startIso: string, endIso: string) {
  const s = ms(startIso), e = ms(endIso);
  let w = 0, nightUnits = 0, units = 0;
  for (let t = Math.floor(s / STEP) * STEP; t < e; t += STEP) {
    const frac = (Math.min(e, t + STEP) - Math.max(s, t)) / STEP;
    const u = Math.round((t - tl.t0) / STEP);
    let ph: number, nt: boolean;
    if (u >= 0 && u < tl.n && tl.period[u] >= 0) {
      ph = tl.perHour[u];
      nt = !!tl.night[u];
    } else {
      const local = DateTime.fromMillis(t, { zone: settings.timezone });
      const hm = local.hour * 60 + local.minute;
      const ns = parseHM(settings.nightStart), ne = parseHM(settings.nightEnd);
      const nsM = ns.hour * 60 + ns.minute, neM = ne.hour * 60 + ne.minute;
      nt = nsM > neM ? hm >= nsM || hm < neM : hm >= nsM && hm < neM;
      ph = nt ? settings.weights.weeknight : settings.weights.day;
    }
    w += (ph * frac) / UNITS_PER_HOUR;
    if (nt) nightUnits += frac;
    units += frac;
  }
  return { weight: round2(w), isNight: units > 0 && nightUnits / units >= 0.5 };
}

/** How many people must be in the tent at an instant (0 if outside the season or in grace). */
export function requiredAt(tl: Timeline, iso: string) {
  const u = Math.floor((ms(iso) - tl.t0) / STEP);
  if (u < 0 || u >= tl.n) return { required: 0, night: false, tent: null as Timeline["tent"][number] };
  return { required: tl.required[u], night: !!tl.night[u], tent: tl.tent[u] };
}

// ---------------------------------------------------------------- generator

export interface GenerateInput {
  settings: GroupSettings;
  memberIds: string[];
  availability: Availability[];
  specials: SpecialPeriod[];
  buddies: Buddy[];
  existing: Shift[];
  /** shifts starting before this are locked */
  now: string;
}

export interface GenerateResult {
  shifts: NewShift[];
  understaffed: { start: string; end: string; missing: number }[];
  loads: Record<string, number>;
}

interface Sh {
  p: number;
  s: number;
  e: number;
}

export function generateSchedule(input: GenerateInput): GenerateResult {
  const { settings } = input;
  const members = input.memberIds.filter(Boolean);
  const P = members.length;
  const tl = buildTimeline(settings, input.specials, P);
  const N = tl.n;
  const idx = new Map(members.map((m, i) => [m, i]));
  const clampU = (u: number) => Math.max(0, Math.min(N, u));
  const uFloor = (iso: string) => clampU(Math.floor((ms(iso) - tl.t0) / STEP));
  const uCeil = (iso: string) => clampU(Math.ceil((ms(iso) - tl.t0) / STEP));
  const nowU = uCeil(input.now);
  const loads = new Float64Array(P);

  const blocked = members.map(() => new Uint8Array(N));
  const pref = members.map(() => new Uint8Array(N));
  const busy = members.map(() => new Uint8Array(N));
  const prev = members.map(() => new Uint8Array(N));
  const nightStarts = members.map(() => new Set<number>());
  const lockedCount = new Int16Array(N);

  for (const a of input.availability) {
    const p = idx.get(a.user_id);
    if (p === undefined) continue;
    const arr = a.kind === "unavailable" ? blocked[p] : pref[p];
    for (let u = uFloor(a.start); u < uCeil(a.end); u++) arr[u] = 1;
  }
  const bud: Set<number>[] = members.map(() => new Set());
  for (const b of input.buddies) {
    const x = idx.get(b.user_id), y = idx.get(b.buddy_id);
    if (x === undefined || y === undefined) continue;
    bud[x].add(y);
    bud[y].add(x);
  }
  const nowMs = ms(input.now);
  for (const s of input.existing) {
    const p = idx.get(s.user_id);
    const locked = ms(s.start) < nowMs || s.source !== "auto";
    if (!locked) {
      if (p !== undefined) for (let u = uFloor(s.start); u < uCeil(s.end); u++) prev[p][u] = 1;
      continue;
    }
    const a = uFloor(s.start), b = uCeil(s.end);
    for (let u = a; u < b; u++) lockedCount[u]++;
    if (p === undefined) continue;
    loads[p] += Number(s.weight) || 0;
    for (let u = a; u < b; u++) busy[p][u] = 1;
    if (s.is_night && a < N) nightStarts[p].add(a);
  }

  const dayTarget = Math.max(2, Math.round(settings.dayShiftHours * UNITS_PER_HOUR));
  const nightTarget = settings.nightShiftHours > 0 ? Math.max(2, Math.round(settings.nightShiftHours * UNITS_PER_HOUR)) : 1 << 20;
  const dayMin = Math.max(1, Math.round((settings.minShiftHours || 1) * UNITS_PER_HOUR));
  const targetAt = (u: number) => (tl.night[u] ? nightTarget : dayTarget);
  const minAt = (u: number) => (tl.night[u] ? Math.min(nightTarget, 2 * UNITS_PER_HOUR) : Math.min(dayMin, dayTarget));

  const weight = (s: number, e: number) => {
    let w = 0;
    for (let u = s; u < e; u++) w += tl.perHour[u];
    return w / UNITS_PER_HOUR;
  };
  const free = (p: number, s: number, e: number) => {
    for (let u = s; u < e; u++) if (busy[p][u] || blocked[p][u]) return false;
    return true;
  };
  const mark = (p: number, s: number, e: number, v: 0 | 1) => {
    for (let u = s; u < e; u++) busy[p][u] = v;
  };

  const softCost = (p: number, s: number, e: number) => {
    let c = 0;
    let pu = 0;
    for (let u = s; u < e; u++) pu += pref[p][u];
    if (pu) c += PREFER_NOT_PENALTY * Math.min(1, pu / UNITS_PER_HOUR) + (PREFER_NOT_PENALTY / 4) * Math.max(0, pu / UNITS_PER_HOUR - 1);
    for (let u = Math.max(0, s - REST_UNITS); u < s; u++)
      if (busy[p][u]) {
        c += BACK_TO_BACK_PENALTY;
        break;
      }
    for (let u = e; u < Math.min(N, e + REST_UNITS); u++)
      if (busy[p][u]) {
        c += BACK_TO_BACK_PENALTY;
        break;
      }
    if (tl.night[s]) {
      for (const ns of nightStarts[p]) if (ns !== s && Math.abs(ns - s) < 30 * UNITS_PER_HOUR) c += CONSECUTIVE_NIGHT_PENALTY;
      for (const b of bud[p]) if (busy[b][s] || busy[b][Math.max(s, e - 1)]) c -= BUDDY_BONUS;
    }
    if (prev[p][s]) c -= STABILITY_BONUS;
    const minU = minAt(s);
    if (e - s < minU) c += (SHORT_SHIFT_PENALTY * (minU - (e - s))) / minU;
    return c;
  };

  const out: Sh[] = [];
  const add = (sh: Sh) => {
    out.push(sh);
    mark(sh.p, sh.s, sh.e, 1);
    loads[sh.p] += weight(sh.s, sh.e);
    if (tl.night[sh.s]) nightStarts[sh.p].add(sh.s);
  };

  // ---- 1. chronological greedy fill
  let active: Sh[] = [];
  for (let i = nowU; i < N; i++) {
    active = active.filter((a) => a.e > i);
    let need = tl.required[i] - lockedCount[i] - active.length;
    if (need < 0) {
      active.sort((a, b) => a.s - b.s);
      while (need < 0 && active.length) {
        const a = active.shift()!;
        mark(a.p, i, a.e, 0);
        loads[a.p] -= weight(i, a.e);
        a.e = i;
        need++;
      }
      continue;
    }
    while (need > 0) {
      let best = -1, bestScore = Infinity, bestEnd = i;
      const segEnd = tl.segEnd[i];
      const lim = Math.min(segEnd, i + targetAt(i));
      const minU = minAt(i);
      for (let p = 0; p < P; p++) {
        if (busy[p][i] || blocked[p][i]) continue;
        let e = i;
        while (e < lim && !busy[p][e] && !blocked[p][e]) e++;
        // avoid leaving a tiny leftover at the end of the period
        if (e === lim && lim < segEnd && segEnd - lim < minU && free(p, lim, segEnd)) e = segEnd;
        const score = loads[p] + softCost(p, i, e) - (e - i) * 0.01;
        if (score < bestScore - 1e-9) {
          bestScore = score;
          best = p;
          bestEnd = e;
        }
      }
      if (best < 0) break;
      const sh = { p: best, s: i, e: bestEnd };
      add(sh);
      active.push(sh);
      need--;
    }
  }

  // ---- 2. local search: hand a whole shift to someone else
  for (let pass = 0; pass < 30; pass++) {
    let improved = false;
    for (const X of out) {
      if (X.e <= X.s) continue;
      const a = X.p;
      const w = weight(X.s, X.e);
      const softA = softCost(a, X.s, X.e);
      mark(a, X.s, X.e, 0);
      const la = loads[a];
      let bestB = -1, bestD = -1e-6;
      for (let b = 0; b < P; b++) {
        if (b === a || !free(b, X.s, X.e)) continue;
        const lb = loads[b];
        const dLoad = (la - w) ** 2 + (lb + w) ** 2 - la ** 2 - lb ** 2;
        const d = dLoad + LAMBDA * (softCost(b, X.s, X.e) - softA);
        if (d < bestD) {
          bestD = d;
          bestB = b;
        }
      }
      if (bestB >= 0) {
        loads[a] -= w;
        loads[bestB] += w;
        nightStarts[a].delete(X.s);
        if (tl.night[X.s]) nightStarts[bestB].add(X.s);
        X.p = bestB;
        improved = true;
      }
      mark(X.p, X.s, X.e, 1);
    }
    if (!improved) break;
  }

  // ---- 3. slide hand-off times (30-min steps) to even things out
  const maxLenAt = (u: number) => targetAt(u) + minAt(u);
  for (let pass = 0; pass < 12; pass++) {
    let improved = false;
    const byStart = new Map<number, Sh[]>();
    for (const Y of out) {
      if (Y.e <= Y.s) continue;
      if (!byStart.has(Y.s)) byStart.set(Y.s, []);
      byStart.get(Y.s)!.push(Y);
    }
    for (const X of out) {
      if (X.e <= X.s) continue;
      for (const Y of byStart.get(X.e) ?? []) {
        if (Y.p === X.p || Y.e <= Y.s || Y.s !== X.e || tl.period[Y.s] !== tl.period[X.s]) continue;
        for (const delta of [2, -2, 4, -4]) {
          const t = X.e + delta;
          if (t <= X.s || t >= Y.e) continue;
          const lenX = t - X.s, lenY = Y.e - t;
          if (lenX > maxLenAt(X.s) || lenY > maxLenAt(Y.s)) continue;
          if ((lenX < minAt(X.s) && lenX < X.e - X.s) || (lenY < minAt(Y.s) && lenY < Y.e - Y.s)) continue;
          const [from, to, gainer, loser] = delta > 0 ? [X.e, t, X.p, Y.p] : [t, X.e, Y.p, X.p];
          if (!free(gainer, from, to)) continue;
          const w = weight(from, to);
          const dLoad = (loads[gainer] + w) ** 2 + (loads[loser] - w) ** 2 - loads[gainer] ** 2 - loads[loser] ** 2;
          let prefD = 0;
          for (let u = from; u < to; u++) prefD += pref[gainer][u] - pref[loser][u];
          if (dLoad + (LAMBDA * PREFER_NOT_PENALTY * prefD) / UNITS_PER_HOUR < -1e-6) {
            mark(loser, from, to, 0);
            mark(gainer, from, to, 1);
            loads[gainer] += w;
            loads[loser] -= w;
            X.e = t;
            Y.s = t;
            improved = true;
            break;
          }
        }
      }
    }
    if (!improved) break;
  }

  // ---- 4. merge back-to-back pieces of the same person
  const merged: Sh[] = [];
  for (const sh of out.filter((x) => x.e > x.s).sort((a, b) => a.p - b.p || a.s - b.s)) {
    const last = merged[merged.length - 1];
    if (last && last.p === sh.p && last.e === sh.s && tl.period[last.s] === tl.period[sh.s] && sh.e - last.s <= maxLenAt(sh.s)) last.e = sh.e;
    else merged.push({ ...sh });
  }

  // ---- result
  const iso = (u: number) => new Date(tl.t0 + u * STEP).toISOString();
  const coverage = new Int16Array(N);
  for (let u = 0; u < N; u++) coverage[u] = lockedCount[u];
  for (const sh of merged) for (let u = sh.s; u < sh.e; u++) coverage[u]++;
  const understaffed: GenerateResult["understaffed"] = [];
  for (let u = nowU; u < N; u++) {
    const miss = tl.required[u] - coverage[u];
    if (miss <= 0) continue;
    const last = understaffed[understaffed.length - 1];
    if (last && last.missing === miss && ms(last.end) === tl.t0 + u * STEP) last.end = iso(u + 1);
    else understaffed.push({ start: iso(u), end: iso(u + 1), missing: miss });
  }

  const shifts: NewShift[] = merged
    .sort((a, b) => a.s - b.s || a.p - b.p)
    .map((sh) => ({
      start: iso(sh.s),
      end: iso(sh.e),
      user_id: members[sh.p],
      is_night: !!tl.night[sh.s],
      weight: round2(weight(sh.s, sh.e)),
      source: "auto",
    }));
  return { shifts, understaffed, loads: Object.fromEntries(members.map((m, i) => [m, round2(loads[i])])) };
}

// ---------------------------------------------------------------- replacements

export interface ReplacementCandidate {
  userId: string;
  score: number;
  load: number;
  reasons: string[];
  preferNot: boolean;
}

/** Rank who should cover `range` (best first). People who can't come or are already on are excluded. */
export function rankReplacements(
  range: Pick<Shift, "start" | "end" | "user_id">,
  memberIds: string[],
  shifts: Shift[],
  availability: Availability[],
): ReplacementCandidate[] {
  const s = ms(range.start), e = ms(range.end);
  const loads: Record<string, number> = Object.fromEntries(memberIds.map((m) => [m, 0]));
  for (const sh of shifts) if (loads[sh.user_id] !== undefined) loads[sh.user_id] += Number(sh.weight) || 0;
  const out: ReplacementCandidate[] = [];
  const minLoad = Math.min(...Object.values(loads));
  for (const u of memberIds) {
    if (u === range.user_id) continue;
    const mine = availability.filter((a) => a.user_id === u && ms(a.start) < e && s < ms(a.end));
    if (mine.some((a) => a.kind === "unavailable")) continue;
    const theirs = shifts.filter((x) => x.user_id === u);
    if (theirs.some((x) => ms(x.start) < e && s < ms(x.end))) continue;
    const reasons: string[] = [];
    let score = loads[u];
    const preferNot = mine.some((a) => a.kind === "prefer_not");
    if (preferNot) {
      score += PREFER_NOT_PENALTY;
      reasons.push("prefers not");
    }
    const near = theirs.find((x) => Math.abs(ms(x.end) - s) < 2 * 3_600_000 || Math.abs(e - ms(x.start)) < 2 * 3_600_000);
    if (near) {
      score += BACK_TO_BACK_PENALTY;
      reasons.push(ms(near.end) <= s ? "just finished a shift" : "has a shift right after");
    }
    if (loads[u] - minLoad < 0.01) reasons.unshift("fewest hours");
    else reasons.unshift(`${Math.round(loads[u])} pts`);
    if (!preferNot && !near) reasons.push("free");
    out.push({ userId: u, score, load: round2(loads[u]), reasons, preferNot });
  }
  return out.sort((a, b) => a.score - b.score);
}

/** Total tenting hours (used for the "can't come" cap). */
export function totalSeasonHours(settings: GroupSettings) {
  if (settings.mode === "game") {
    const a = DateTime.fromISO(settings.game.start, { zone: settings.timezone });
    const b = DateTime.fromISO(settings.game.end, { zone: settings.timezone });
    return a.isValid && b.isValid ? Math.max(0, b.diff(a, "hours").hours) : 0;
  }
  return settings.phases.reduce((acc, p) => {
    const a = DateTime.fromISO(p.start, { zone: settings.timezone });
    const b = DateTime.fromISO(p.end, { zone: settings.timezone }).plus({ days: 1 });
    return acc + Math.max(0, b.diff(a, "hours").hours);
  }, 0);
}
