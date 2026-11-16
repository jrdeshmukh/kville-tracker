import { describe, expect, it } from "vitest";
import { buildTimeline, generateSchedule, rankReplacements, shiftMeta } from "./scheduler";
import { defaultGameSettings, defaultSettings } from "./defaults";
import type { Availability, GroupSettings, NewShift, Shift } from "./types";

const settings = (over: Partial<GroupSettings> = {}): GroupSettings => ({
  ...defaultSettings("black"),
  phases: [
    { type: "black", start: "2027-01-14", end: "2027-01-20" },
    { type: "blue", start: "2027-01-21", end: "2027-01-24" },
  ],
  ...over,
});
const people = (n: number) => Array.from({ length: n }, (_, i) => `u${String(i).padStart(2, "0")}`);
const members = people(12);
const BEFORE = "2027-01-01T00:00:00Z";
const Q = 15 * 60_000;

/** For every 15-min unit, check how many people are on vs required. */
function coverageGaps(s: GroupSettings, shifts: NewShift[], n: number) {
  const tl = buildTimeline(s, [], n);
  let gaps = 0;
  for (let u = 0; u < tl.n; u++) {
    const t = tl.t0 + u * Q;
    const on = shifts.filter((x) => Date.parse(x.start) <= t && t < Date.parse(x.end)).length;
    if (on < tl.required[u]) gaps++;
  }
  return gaps;
}
function noOverlaps(shifts: NewShift[]) {
  const by = new Map<string, NewShift[]>();
  for (const s of shifts) by.set(s.user_id, [...(by.get(s.user_id) ?? []), s]);
  for (const list of by.values()) {
    list.sort((a, b) => a.start.localeCompare(b.start));
    for (let i = 1; i < list.length; i++) if (Date.parse(list[i].start) < Date.parse(list[i - 1].end)) return false;
  }
  return true;
}
const spread = (loads: Record<string, number>) => Math.max(...Object.values(loads)) - Math.min(...Object.values(loads));

describe("buildTimeline", () => {
  it("marks day/night head counts per phase", () => {
    const tl = buildTimeline(settings(), [], 12);
    expect(tl.n).toBe(11 * 24 * 4);
    expect(Math.max(...tl.required)).toBe(10);
    expect([...tl.required].filter((r) => r === 10).length).toBe(7 * 8 * 4); // 7 black nights × 8h
  });

  it("removes grace periods and weights rough periods", () => {
    const s = settings();
    const grace = { id: "g", group_id: "x", kind: "grace" as const, start: "2027-01-15T22:00:00Z", end: "2027-01-16T01:00:00Z", note: null };
    const tl = buildTimeline(s, [grace], 12);
    const u = (Date.parse("2027-01-15T23:00:00Z") - tl.t0) / Q;
    expect(tl.required[u]).toBe(0);
    const meta = shiftMeta(buildTimeline(s, [{ ...grace, kind: "harsh" }], 12), s, "2027-01-15T22:00:00Z", "2027-01-15T23:00:00Z");
    expect(meta.weight).toBe(2);
  });

  it("game mode needs ceil(n/3) people around the clock", () => {
    const g = { ...defaultGameSettings(), game: { opponent: "Illinois", start: "2027-01-14T12:00", end: "2027-01-16T19:00", fraction: 1 / 3 } };
    const tl = buildTimeline(g, [], 14);
    expect(new Set(tl.required)).toEqual(new Set([5]));
    expect(tl.n).toBe(55 * 4);
  });
});

describe("generateSchedule", () => {
  it("covers every minute and balances weighted hours", () => {
    const s = settings();
    const r = generateSchedule({ settings: s, memberIds: members, availability: [], specials: [], buddies: [], existing: [], now: BEFORE });
    expect(r.understaffed).toEqual([]);
    expect(coverageGaps(s, r.shifts, 12)).toBe(0);
    expect(noOverlaps(r.shifts)).toBe(true);
    expect(spread(r.loads)).toBeLessThanOrEqual(6);
  });

  it("hands off mid-block when a class ends at an odd time", () => {
    const s = settings();
    // u00..u09 all have class 9:00–10:45 ET on Jan 15 (14:00–15:45Z)
    const avail: Availability[] = members.slice(0, 10).map((u, i) => ({
      id: `c${i}`, group_id: "g", user_id: u, kind: "unavailable", start: "2027-01-15T14:00:00Z", end: "2027-01-15T15:45:00Z",
    }));
    // …and u10/u11 (the only ones free during that class) have their own class from 10:45
    for (const u of ["u10", "u11"])
      avail.push({ id: `d${u}`, group_id: "g", user_id: u, kind: "unavailable", start: "2027-01-15T15:45:00Z", end: "2027-01-15T18:00:00Z" });
    const r = generateSchedule({ settings: s, memberIds: members, availability: avail, specials: [], buddies: [], existing: [], now: BEFORE });
    expect(coverageGaps(s, r.shifts, 12)).toBe(0);
    for (const a of avail)
      expect(r.shifts.some((x) => x.user_id === a.user_id && Date.parse(x.start) < Date.parse(a.end) && Date.parse(a.start) < Date.parse(x.end))).toBe(false);
    // somebody's shift starts or ends exactly at the 10:45 hand-off (not on an even 2h boundary)
    expect(r.shifts.some((x) => x.start === "2027-01-15T15:45:00.000Z" || x.end === "2027-01-15T15:45:00.000Z")).toBe(true);
  });

  it("game mode: 1/3 of the group in the tent at all times", () => {
    const g = { ...defaultGameSettings(), game: { opponent: "Illinois", start: "2027-01-14T12:00", end: "2027-01-16T19:00", fraction: 1 / 3 } };
    const ms = people(15);
    const r = generateSchedule({ settings: g, memberIds: ms, availability: [], specials: [], buddies: [], existing: [], now: BEFORE });
    expect(r.understaffed).toEqual([]);
    expect(coverageGaps(g, r.shifts, 15)).toBe(0);
    expect(noOverlaps(r.shifts)).toBe(true);
    expect(spread(r.loads)).toBeLessThanOrEqual(4);
  });

  it("keeps past, manual and swapped shifts; reports understaffing", () => {
    const s = settings();
    const r1 = generateSchedule({ settings: s, memberIds: members.slice(0, 5), availability: [], specials: [], buddies: [], existing: [], now: BEFORE });
    expect(r1.understaffed.length).toBeGreaterThan(0);

    const base = generateSchedule({ settings: s, memberIds: members, availability: [], specials: [], buddies: [], existing: [], now: BEFORE });
    const target = base.shifts.find((x) => !x.is_night)!;
    const existing: Shift[] = base.shifts.map((x, i) => ({
      ...x, id: `s${i}`, group_id: "g", checked_in_at: null,
      ...(x === target ? { user_id: "u11", source: "swap" as const } : {}),
    }));
    const r2 = generateSchedule({ settings: s, memberIds: members, availability: [], specials: [], buddies: [], existing, now: BEFORE });
    expect(r2.shifts.some((x) => x.user_id === "u11" && Date.parse(x.start) < Date.parse(target.end) && Date.parse(target.start) < Date.parse(x.end))).toBe(false);
    expect(coverageGaps(s, [...r2.shifts, { ...target, user_id: "u11" }], 12)).toBe(0);

    const now = "2027-01-17T12:00:00Z";
    const r3 = generateSchedule({ settings: s, memberIds: members, availability: [], specials: [], buddies: [], existing, now });
    expect(r3.shifts.every((x) => Date.parse(x.start) >= Date.parse(now))).toBe(true);
  });

  it("avoids prefer-not hours when possible", () => {
    const avail: Availability[] = [{ id: "p", group_id: "g", user_id: "u01", start: "2027-01-14T12:00:00Z", end: "2027-01-16T04:00:00Z", kind: "prefer_not" }];
    const r = generateSchedule({ settings: settings(), memberIds: members, availability: avail, specials: [], buddies: [], existing: [], now: BEFORE });
    const hits = r.shifts.filter((x) => x.user_id === "u01" && Date.parse(x.start) < Date.parse(avail[0].end) && Date.parse(avail[0].start) < Date.parse(x.end) && !x.is_night);
    expect(hits.length).toBe(0);
  });
});

describe("rankReplacements", () => {
  it("excludes unavailable and busy people and ranks by load", () => {
    const shift: Shift = { id: "x", group_id: "g", start: "2027-01-15T15:00:00Z", end: "2027-01-15T17:00:00Z", user_id: "a", is_night: false, weight: 2, source: "auto", checked_in_at: null };
    const shifts: Shift[] = [shift, { ...shift, id: "y", user_id: "b" }, { ...shift, id: "z", user_id: "c", start: "2027-01-16T15:00:00Z", end: "2027-01-16T23:00:00Z", weight: 8 }];
    const avail: Availability[] = [{ id: "1", group_id: "g", user_id: "d", start: "2027-01-15T16:30:00Z", end: "2027-01-15T18:00:00Z", kind: "unavailable" }];
    expect(rankReplacements(shift, ["a", "b", "c", "d", "e"], shifts, avail).map((x) => x.userId)).toEqual(["e", "c"]);
    // only the first hour: d becomes available
    const part = { ...shift, end: "2027-01-15T16:00:00Z" };
    expect(rankReplacements(part, ["a", "b", "c", "d", "e"], shifts, avail).map((x) => x.userId)).toContain("d");
  });
});
