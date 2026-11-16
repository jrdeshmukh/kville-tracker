"use client";
import { DateTime } from "luxon";
import { defaultGameSettings, defaultSettings, randomCode, TZ, uid } from "../defaults";
import { generateSchedule } from "../scheduler";
import type {
  Alert,
  Availability,
  Buddy,
  Expense,
  GearItem,
  Group,
  Member,
  Profile,
  Shift,
  SpecialPeriod,
  SwapRequest,
} from "../types";
import type { DataApi } from "./api";

/**
 * Demo backend: everything lives in this browser's localStorage. Used automatically when
 * no Supabase keys are configured, so the whole app can be tried without setup.
 */

interface DemoState {
  me: string | null;
  profiles: Profile[];
  groups: Group[];
  members: Omit<Member, "profile">[];
  availability: Availability[];
  specials: SpecialPeriod[];
  shifts: Shift[];
  swaps: SwapRequest[];
  expenses: Expense[];
  gear: GearItem[];
  buddies: Buddy[];
  alerts: Alert[];
}

const KEY = "kville-demo-v2";
const listeners = new Set<() => void>();

const NAMES = [
  "You", "Maya Patel", "Jordan Lee", "Chris Okafor", "Sam Rivera", "Ava Chen", "Ethan Brooks", "Priya Shah", "Leo Martins", "Nora Kim",
  "Ben Torres", "Zoe Adams", "Omar Haddad", "Lily Wong", "Max Fischer",
];

function seed(): DemoState {
  const people: Profile[] = NAMES.map((n, i) => ({
    id: i === 0 ? "demo-you" : `demo-${n.split(" ")[0].toLowerCase()}`,
    display_name: i === 0 ? "Casey Demo" : n,
    venmo: i === 0 ? null : n.split(" ")[0].toLowerCase() + "-tents",
    avatar_url: null,
  }));
  const today = DateTime.now().setZone(TZ).startOf("day");
  const d = (n: number) => today.plus({ days: n }).toISODate()!;
  let rng = 7;
  const rand = () => (rng = (rng * 9301 + 49297) % 233280) / 233280;

  /** Realistic class schedules: MWF and TTh classes with odd end times, plus a few evening events. */
  const classesFor = (groupId: string, p: Profile, from: DateTime, days: number): Availability[] => {
    const out: Availability[] = [];
    const patterns = [
      { days: [1, 3, 5], h: 8, m: 30, len: 75 },
      { days: [1, 3, 5], h: 10, m: 5, len: 50 },
      { days: [2, 4], h: 11, m: 45, len: 75 },
      { days: [2, 4], h: 13, m: 25, len: 75 },
      { days: [1, 3], h: 15, m: 5, len: 75 },
      { days: [2, 4], h: 16, m: 40, len: 75 },
    ];
    const mine = patterns.filter(() => rand() < 0.4);
    for (let i = 0; i < days; i++) {
      const day = from.plus({ days: i });
      for (const c of mine)
        if (c.days.includes(day.weekday)) {
          const st = day.set({ hour: c.h, minute: c.m });
          out.push({ id: uid(), group_id: groupId, user_id: p.id, kind: "unavailable", start: st.toUTC().toISO()!, end: st.plus({ minutes: c.len }).toUTC().toISO()! });
        }
      if (rand() < 0.08) {
        const st = day.set({ hour: 18, minute: 30 });
        out.push({ id: uid(), group_id: groupId, user_id: p.id, kind: rand() < 0.5 ? "unavailable" : "prefer_not", start: st.toUTC().toISO()!, end: st.plus({ minutes: 150 }).toUTC().toISO()! });
      }
    }
    return out;
  };

  // ---------------- Carolina group (10 people)
  const carolinaPeople = people.slice(0, 10);
  const settings = defaultSettings("black");
  settings.phases = [
    { type: "black", start: d(-4), end: d(8) },
    { type: "blue", start: d(9), end: d(19) },
    { type: "white", start: d(20), end: d(33) },
  ];
  const g: Group = {
    id: "demo-group", name: "Section 17 Crazies", invite_code: "DEMO42", settings, created_by: people[0].id,
    published_at: new Date().toISOString(), created_at: new Date().toISOString(),
  };
  // ---------------- Game group vs Illinois (15 people, 1/3 rule)
  const gameSettings = defaultGameSettings();
  gameSettings.game = {
    opponent: "Illinois",
    start: today.minus({ days: 1 }).set({ hour: 12 }).toFormat("yyyy-LL-dd'T'HH:mm"),
    end: today.plus({ days: 2 }).set({ hour: 19 }).toFormat("yyyy-LL-dd'T'HH:mm"),
    fraction: 1 / 3,
  };
  const g2: Group = {
    id: "demo-game", name: "Illinois Walk-Up Crew", invite_code: "ILLINI", settings: gameSettings, created_by: people[0].id,
    published_at: new Date().toISOString(), created_at: new Date().toISOString(),
  };

  const members = [
    ...carolinaPeople.map((p, i) => ({ group_id: g.id, user_id: p.id, role: (i < 2 ? "admin" : "member") as Member["role"], joined_at: g.created_at, submitted_at: g.created_at })),
    ...people.map((p, i) => ({ group_id: g2.id, user_id: p.id, role: (i === 0 ? "admin" : "member") as Member["role"], joined_at: g2.created_at, submitted_at: g2.created_at })),
  ];

  const availability: Availability[] = [];
  for (const p of carolinaPeople.slice(1)) availability.push(...classesFor(g.id, p, today.minus({ days: 4 }), 38));
  for (const p of people.slice(1)) availability.push(...classesFor(g2.id, p, today.minus({ days: 1 }), 4));

  const specials: SpecialPeriod[] = [
    {
      id: uid(), group_id: g.id, kind: "grace", note: "Home game — grace period",
      start: today.plus({ days: 3 }).set({ hour: 17 }).toUTC().toISO()!, end: today.plus({ days: 3 }).set({ hour: 23 }).toUTC().toISO()!,
    },
    {
      id: uid(), group_id: g.id, kind: "harsh", note: "Forecast: 18°F + snow",
      start: today.plus({ days: 1 }).set({ hour: 23 }).toUTC().toISO()!, end: today.plus({ days: 2 }).set({ hour: 7 }).toUTC().toISO()!,
    },
    {
      id: uid(), group_id: g2.id, kind: "harsh", note: "Rain overnight",
      start: today.set({ hour: 23 }).toUTC().toISO()!, end: today.plus({ days: 1 }).set({ hour: 7 }).toUTC().toISO()!,
    },
  ];
  const buddies: Buddy[] = [
    { group_id: g.id, user_id: people[1].id, buddy_id: people[2].id },
    { group_id: g.id, user_id: people[3].id, buddy_id: people[4].id },
  ];
  const nowMs = Date.now();
  const shifts: Shift[] = [];
  for (const [grp, ppl] of [[g, carolinaPeople], [g2, people]] as const) {
    const res = generateSchedule({
      settings: grp.settings, memberIds: ppl.map((p) => p.id), availability: availability.filter((a) => a.group_id === grp.id),
      specials: specials.filter((x) => x.group_id === grp.id), buddies: buddies.filter((b) => b.group_id === grp.id), existing: [],
      now: today.minus({ days: 30 }).toUTC().toISO()!,
    });
    for (const sh of res.shifts)
      shifts.push({ ...sh, id: uid(), group_id: grp.id, checked_in_at: Date.parse(sh.start) < nowMs && rand() < 0.9 ? sh.start : null });
  }

  const cents = (n: number) => Math.round(n * 100);
  const mkExpense = (grp: Group, ppl: Profile[], title: string, total: number, buyer: string, paidIdx: number[]): Expense => {
    const id = uid();
    const each = Math.floor(cents(total) / ppl.length);
    const shares = ppl.map((p, i) => ({
      expense_id: id, user_id: p.id,
      amount_cents: i === 0 ? cents(total) - each * (ppl.length - 1) : each,
      paid_at: p.id === buyer || paidIdx.includes(i) ? new Date().toISOString() : null,
    }));
    return { id, group_id: grp.id, title, total_cents: cents(total), buyer_id: buyer, created_at: new Date().toISOString(), shares };
  };
  const expenses = [
    mkExpense(g, carolinaPeople, "12-person tent + tarp", 389.9, people[1].id, [2, 3, 5, 6, 9]),
    mkExpense(g, carolinaPeople, "Propane heater + 6 tanks", 162.4, people[3].id, [0, 1, 4, 7, 8]),
    mkExpense(g2, people, "Borrowed-tent tarp + pizza", 96, people[0].id, [1, 2, 3, 4, 5, 6]),
  ];
  const gear: GearItem[] = [
    ["Tent (12-person)", 1, true], ["Heater + propane", 3, true], ["Tarp & stakes", 2, true],
    ["Air mattresses ×4", 5, false], ["Extension cord", null, false], ["Hand warmers", 7, false],
  ].map(([name, who, done]) => ({
    id: uid(), group_id: g.id, name: name as string, assignee_id: who === null ? null : people[who as number].id, done: done as boolean,
  }));
  return {
    me: null, profiles: people, groups: [g, g2], members, availability, specials, shifts, swaps: [], expenses, gear, buddies,
    alerts: [{ id: uid(), group_id: g.id, created_by: people[1].id, message: "Practice tent check went fine — 10/10 present 🙌", created_at: today.set({ hour: 2 }).toUTC().toISO()! }],
  };
}

/** Give [start,end) of a shift to someone else, keeping the rest with the original person. */
function handOver(s: DemoState, sh: Shift, to: string, source: Shift["source"], range?: { start: string; end: string } | null) {
  const a = Math.max(Date.parse(sh.start), range ? Date.parse(range.start) : -Infinity);
  const b = Math.min(Date.parse(sh.end), range ? Date.parse(range.end) : Infinity);
  if (b <= a) throw new Error("That time isn't part of the shift");
  const per = Number(sh.weight) / (Date.parse(sh.end) - Date.parse(sh.start));
  const piece = (x: number, y: number) => Math.round(per * (y - x) * 100) / 100;
  const iso = (t: number) => new Date(t).toISOString();
  if (a === Date.parse(sh.start) && b === Date.parse(sh.end)) {
    Object.assign(sh, { user_id: to, source, checked_in_at: null });
    return;
  }
  s.shifts.push({ ...sh, id: uid(), start: iso(a), end: iso(b), user_id: to, source, weight: piece(a, b), checked_in_at: null });
  const origEnd = Date.parse(sh.end);
  if (a > Date.parse(sh.start)) {
    if (b < origEnd) s.shifts.push({ ...sh, id: uid(), start: iso(b), end: iso(origEnd), weight: piece(b, origEnd), checked_in_at: null });
    sh.weight = piece(Date.parse(sh.start), a);
    sh.end = iso(a);
  } else {
    sh.weight = piece(b, origEnd);
    sh.start = iso(b);
  }
}

let state: DemoState | null = null;
function load(): DemoState {
  if (state) return state;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) state = JSON.parse(raw);
  } catch {}
  if (!state) state = seed();
  return state!;
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {}
  setTimeout(() => listeners.forEach((l) => l()), 0);
}
function mutate(fn: (s: DemoState) => void) {
  fn(load());
  save();
}
const me = () => load().me;
function requireMe() {
  const id = me();
  if (!id) throw new Error("Sign in first");
  return id;
}
function isAdmin(groupId: string) {
  return load().members.some((m) => m.group_id === groupId && m.user_id === me() && m.role === "admin");
}
function requireAdmin(groupId: string) {
  if (!isAdmin(groupId)) throw new Error("Admins only");
}

export function demoReset() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
  state = null;
  save();
}
export function demoPeople() {
  return load().profiles;
}
export function demoActAs(id: string) {
  mutate((s) => (s.me = id));
}

export function createDemoApi(): DataApi {
  const api: DataApi = {
    mode: "demo",
    async currentUserId() {
      return me();
    },
    async signIn() {
      mutate((s) => (s.me = s.profiles[0].id));
    },
    async signInWithPassword() {
      mutate((s) => (s.me = s.profiles[0].id));
    },
    async signUp() {
      mutate((s) => (s.me = s.profiles[0].id));
      return "signed_in" as const;
    },
    async signOut() {
      mutate((s) => (s.me = null));
    },
    onAuthChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    async getProfile() {
      return load().profiles.find((p) => p.id === me()) ?? null;
    },
    async updateProfile(patch) {
      mutate((s) => {
        const p = s.profiles.find((x) => x.id === me());
        if (p) Object.assign(p, patch);
      });
    },
    async calendarFeedUrl() {
      return null;
    },
    async listMyGroups() {
      const s = load();
      return s.members
        .filter((m) => m.user_id === me())
        .map((m) => ({
          role: m.role,
          group: s.groups.find((g) => g.id === m.group_id)!,
          memberCount: s.members.filter((x) => x.group_id === m.group_id).length,
        }))
        .filter((x) => x.group);
    },
    async createGroup(name, settings) {
      const id = requireMe();
      const g: Group = { id: uid(), name, invite_code: randomCode(), settings, created_by: id, published_at: null, created_at: new Date().toISOString() };
      mutate((s) => {
        s.groups.push(g);
        s.members.push({ group_id: g.id, user_id: id, role: "admin", joined_at: g.created_at, submitted_at: null });
      });
      return g;
    },
    async joinGroup(code) {
      const id = requireMe();
      const s = load();
      const g = s.groups.find((x) => x.invite_code === code.trim().toUpperCase());
      if (!g) throw new Error("No group with that code");
      if (s.members.some((m) => m.group_id === g.id && m.user_id === id)) return g.id;
      const count = s.members.filter((m) => m.group_id === g.id).length;
      if (g.settings.maxMembers != null && count >= g.settings.maxMembers) throw new Error(`This group is full (${g.settings.maxMembers} max)`);
      mutate((st) => st.members.push({ group_id: g.id, user_id: id, role: "member", joined_at: new Date().toISOString(), submitted_at: null }));
      return g.id;
    },
    async getBundle(groupId) {
      const s = load();
      const group = s.groups.find((g) => g.id === groupId);
      if (!group || !s.members.some((m) => m.group_id === groupId && m.user_id === me())) throw new Error("Group not found");
      const by = <T extends { group_id: string }>(arr: T[]) => structuredClone(arr.filter((x) => x.group_id === groupId));
      return {
        group: structuredClone(group),
        members: by(s.members).map((m) => ({ ...m, profile: structuredClone(s.profiles.find((p) => p.id === m.user_id)!) })),
        availability: by(s.availability),
        specials: by(s.specials),
        shifts: by(s.shifts).sort((a, b) => a.start.localeCompare(b.start)),
        swaps: by(s.swaps).reverse(),
        expenses: by(s.expenses).reverse(),
        gear: by(s.gear),
        buddies: by(s.buddies),
        alerts: by(s.alerts).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 20),
      };
    },
    async updateGroup(groupId, patch) {
      requireAdmin(groupId);
      mutate((s) => Object.assign(s.groups.find((g) => g.id === groupId)!, patch));
    },
    async deleteGroup(groupId) {
      requireAdmin(groupId);
      mutate((s) => {
        s.groups = s.groups.filter((g) => g.id !== groupId);
        s.members = s.members.filter((m) => m.group_id !== groupId);
      });
    },
    async setRole(groupId, userId, role) {
      requireAdmin(groupId);
      mutate((s) => (s.members.find((m) => m.group_id === groupId && m.user_id === userId)!.role = role));
    },
    async removeMember(groupId, userId) {
      if (userId !== me()) requireAdmin(groupId);
      mutate((s) => (s.members = s.members.filter((m) => !(m.group_id === groupId && m.user_id === userId))));
    },
    async markSubmitted(groupId, done) {
      mutate((s) => {
        const m = s.members.find((x) => x.group_id === groupId && x.user_id === me());
        if (m) m.submitted_at = done ? new Date().toISOString() : null;
      });
    },
    async replaceMyAvailability(groupId, ranges) {
      const id = requireMe();
      mutate((s) => {
        s.availability = s.availability.filter((a) => !(a.group_id === groupId && a.user_id === id));
        for (const r of ranges) s.availability.push({ id: uid(), group_id: groupId, user_id: id, ...r });
      });
    },
    async addSpecial(groupId, p) {
      requireAdmin(groupId);
      mutate((s) => s.specials.push({ id: uid(), group_id: groupId, ...p }));
    },
    async deleteSpecial(id) {
      mutate((s) => (s.specials = s.specials.filter((x) => x.id !== id)));
    },
    async replaceFutureShifts(groupId, fromIso, shifts) {
      requireAdmin(groupId);
      const from = Date.parse(fromIso);
      mutate((s) => {
        s.shifts = s.shifts.filter((x) => !(x.group_id === groupId && Date.parse(x.start) >= from && x.source === "auto"));
        for (const sh of shifts) s.shifts.push({ ...sh, id: uid(), group_id: groupId, checked_in_at: null });
      });
    },
    async addShift(groupId, sh) {
      requireAdmin(groupId);
      mutate((s) => s.shifts.push({ ...sh, id: uid(), group_id: groupId, checked_in_at: null }));
    },
    async deleteShift(id) {
      mutate((s) => (s.shifts = s.shifts.filter((x) => x.id !== id)));
    },
    async reassignShift(id, userId, range) {
      mutate((s) => {
        const sh = s.shifts.find((x) => x.id === id)!;
        requireAdmin(sh.group_id);
        handOver(s, sh, userId, "manual", range);
      });
    },
    async checkIn(shiftId) {
      mutate((s) => {
        const sh = s.shifts.find((x) => x.id === shiftId && x.user_id === me());
        if (sh) sh.checked_in_at = new Date().toISOString();
      });
    },
    async requestSwap(groupId, shiftId, fromUser, toUser, range) {
      mutate((s) =>
        s.swaps.push({
          id: uid(), group_id: groupId, shift_id: shiftId, from_user: fromUser, to_user: toUser,
          start: range?.start ?? null, end: range?.end ?? null, status: "pending", created_at: new Date().toISOString(),
        }),
      );
    },
    async respondSwap(swapId, accept) {
      mutate((s) => {
        const r = s.swaps.find((x) => x.id === swapId && x.status === "pending");
        if (!r) throw new Error("Request is no longer open");
        if (r.to_user !== me()) throw new Error("Not your request");
        if (accept) {
          const sh = s.shifts.find((x) => x.id === r.shift_id && x.user_id === r.from_user);
          if (!sh) throw new Error("Shift already changed");
          handOver(s, sh, r.to_user, "swap", r.start && r.end ? { start: r.start, end: r.end } : null);
          r.status = "accepted";
          for (const o of s.swaps) if (o.shift_id === r.shift_id && o.status === "pending") o.status = "cancelled";
        } else r.status = "declined";
      });
    },
    async cancelSwap(swapId) {
      mutate((s) => (s.swaps.find((x) => x.id === swapId)!.status = "cancelled"));
    },
    async createExpense(groupId, e) {
      requireAdmin(groupId);
      const id = uid();
      mutate((s) =>
        s.expenses.push({
          id, group_id: groupId, title: e.title, total_cents: e.total_cents, buyer_id: e.buyer_id, created_at: new Date().toISOString(),
          shares: e.shares.map((x) => ({ ...x, expense_id: id, paid_at: x.user_id === e.buyer_id ? new Date().toISOString() : null })),
        }),
      );
    },
    async deleteExpense(id) {
      mutate((s) => (s.expenses = s.expenses.filter((x) => x.id !== id)));
    },
    async setBuyer(expenseId, buyerId) {
      mutate((s) => (s.expenses.find((x) => x.id === expenseId)!.buyer_id = buyerId));
    },
    async setPaid(expenseId, userId, paid) {
      mutate((s) => {
        const e = s.expenses.find((x) => x.id === expenseId)!;
        if (e.buyer_id !== me() && !isAdmin(e.group_id)) throw new Error("Only the buyer or an admin can mark payments");
        const sh = e.shares.find((x) => x.user_id === userId);
        if (sh) sh.paid_at = paid ? new Date().toISOString() : null;
      });
    },
    async addGear(groupId, name) {
      mutate((s) => s.gear.push({ id: uid(), group_id: groupId, name, assignee_id: null, done: false }));
    },
    async updateGear(id, patch) {
      mutate((s) => Object.assign(s.gear.find((x) => x.id === id)!, patch));
    },
    async deleteGear(id) {
      mutate((s) => (s.gear = s.gear.filter((x) => x.id !== id)));
    },
    async setBuddies(groupId, buddyIds) {
      const id = requireMe();
      mutate((s) => {
        s.buddies = s.buddies.filter((b) => !(b.group_id === groupId && b.user_id === id));
        for (const b of buddyIds) s.buddies.push({ group_id: groupId, user_id: id, buddy_id: b });
      });
    },
    async sendAlert(groupId, message) {
      const id = requireMe();
      mutate((s) => s.alerts.push({ id: uid(), group_id: groupId, created_by: id, message, created_at: new Date().toISOString() }));
    },
    async notify() {},
    async savePushSubscription() {},
    subscribe(_groupId, onChange) {
      listeners.add(onChange);
      const onStorage = (e: StorageEvent) => {
        if (e.key === KEY) {
          state = null;
          onChange();
        }
      };
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(onChange);
        window.removeEventListener("storage", onStorage);
      };
    },
  };
  return api;
}
