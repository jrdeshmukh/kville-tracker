import { DateTime } from "luxon";
import type { GroupSettings, Phase, TentType } from "./types";

export const TZ = "America/New_York";

export const TENT_INFO: Record<
  TentType | "game",
  { label: string; blurb: string; color: string; text: string }
> = {
  black: {
    label: "Black",
    blurb: "Longest & hardest. Most people needed overnight.",
    color: "#1c1c1a",
    text: "#f6f6f4",
  },
  blue: {
    label: "Blue",
    blurb: "Middle phase. Fewer people at night.",
    color: "#bce6fa",
    text: "#1c1c1a",
  },
  white: {
    label: "White",
    blurb: "Final stretch. Smallest night crew.",
    color: "#fafaf8",
    text: "#1c1c1a",
  },
  game: {
    label: "Game",
    blurb: "Non-UNC game. A share of the group in the tent at all times.",
    color: "#c4f041",
    text: "#1c1c1a",
  },
};

/** "1/3" style label for a fraction */
export function fractionLabel(f: number) {
  for (const d of [2, 3, 4, 5, 6]) for (let n = 1; n < d; n++) if (Math.abs(f - n / d) < 0.005) return `${n}/${d}`;
  return `${Math.round(f * 100)}%`;
}

/** Typical K-Ville requirements. Rules change yearly: admins can edit all of this. */
export const DEFAULT_REQUIREMENTS: GroupSettings["requirements"] = {
  black: { day: 2, night: 10 },
  blue: { day: 1, night: 6 },
  white: { day: 1, night: 2 },
};

/** Typical 2027 season, editable per group. Inclusive dates. */
export const DEFAULT_PHASES: Phase[] = [
  { type: "black", start: "2027-01-14", end: "2027-01-27" },
  { type: "blue", start: "2027-01-28", end: "2027-02-10" },
  { type: "white", start: "2027-02-11", end: "2027-03-05" },
];

export function defaultGame(): GroupSettings["game"] {
  const start = DateTime.now().setZone(TZ).plus({ days: 1 }).set({ hour: 12, minute: 0 });
  return {
    opponent: "Illinois",
    start: start.toFormat("yyyy-LL-dd'T'HH:mm"),
    end: start.plus({ days: 2 }).set({ hour: 19 }).toFormat("yyyy-LL-dd'T'HH:mm"),
    fraction: 1 / 3,
  };
}

export function defaultGameSettings(): GroupSettings {
  return { ...defaultSettings("black"), mode: "game", game: defaultGame(), maxMembers: null, dayShiftHours: 3 };
}

export function defaultSettings(startTent: TentType = "black"): GroupSettings {
  const order: TentType[] = ["black", "blue", "white"];
  const phases = DEFAULT_PHASES.filter(
    (p) => order.indexOf(p.type) >= order.indexOf(startTent),
  );
  return {
    mode: "carolina",
    game: defaultGame(),
    timezone: TZ,
    phases,
    requirements: structuredClone(DEFAULT_REQUIREMENTS),
    nightStart: "23:00",
    nightEnd: "07:00",
    dayShiftHours: 2,
    minShiftHours: 1,
    nightShiftHours: 0,
    weights: { day: 1, weeknight: 1.5, weekendNight: 1.25, harsh: 2 },
    maxBlockedPct: 30,
    maxMembers: 12,
    reminderMinutes: 30,
  };
}

/** Fill any missing keys (older groups) with defaults. */
export function normalizeSettings(s: Partial<GroupSettings> | null | undefined): GroupSettings {
  const d = defaultSettings();
  return {
    ...d,
    ...(s ?? {}),
    requirements: { ...d.requirements, ...(s?.requirements ?? {}) },
    weights: { ...d.weights, ...(s?.weights ?? {}) },
    game: { ...d.game, ...(s?.game ?? {}) },
    mode: s?.mode ?? "carolina",
    phases: s?.phases?.length ? s.phases : d.phases,
  };
}

// ---------- time helpers ----------

export const dt = (iso: string, tz = TZ) => DateTime.fromISO(iso, { zone: tz });
export const nowIso = () => new Date().toISOString();

export function fmtTime(iso: string, tz = TZ) {
  const d = dt(iso, tz);
  return d.minute === 0 ? d.toFormat("ha").toLowerCase() : d.toFormat("h:mma").toLowerCase();
}
export function fmtRange(a: string, b: string, tz = TZ) {
  return `${fmtTime(a, tz)} – ${fmtTime(b, tz)}`;
}
export function fmtDay(iso: string, tz = TZ) {
  return dt(iso, tz).toFormat("ccc, LLL d");
}
export function hoursBetween(a: string, b: string) {
  return (Date.parse(b) - Date.parse(a)) / 3_600_000;
}
export function overlaps(a1: string, a2: string, b1: string, b2: string) {
  return Date.parse(a1) < Date.parse(b2) && Date.parse(b1) < Date.parse(a2);
}
export function money(cents: number) {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}
export function relTime(iso: string) {
  const diff = Date.parse(iso) - Date.now();
  const abs = Math.abs(diff);
  const m = Math.round(abs / 60000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  const s = d >= 1 ? `${d}d ${h % 24}h` : h >= 1 ? `${h}h ${m % 60}m` : `${m}m`;
  return diff >= 0 ? `in ${s}` : `${s} ago`;
}

export function randomCode(len = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  for (const n of arr) out += chars[n % chars.length];
  return out;
}

export function uid() {
  return crypto.randomUUID();
}
