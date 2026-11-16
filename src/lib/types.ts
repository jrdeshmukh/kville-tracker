export type TentType = "black" | "blue" | "white";
export type Role = "admin" | "member";
export type AvailabilityKind = "unavailable" | "prefer_not";
export type SpecialKind = "grace" | "harsh";
export type ShiftSource = "auto" | "manual" | "swap";

export interface Phase {
  type: TentType;
  /** YYYY-MM-DD, inclusive */
  start: string;
  /** YYYY-MM-DD, inclusive (the night that starts on this date is included) */
  end: string;
}

export interface Weights {
  day: number;
  weeknight: number;
  weekendNight: number;
  harsh: number;
}

export type GroupMode = "carolina" | "game";

export interface GameSettings {
  opponent: string;
  /** local "YYYY-MM-DDTHH:mm" when tenting starts */
  start: string;
  /** local "YYYY-MM-DDTHH:mm" when tenting ends (usually game time / line-up) */
  end: string;
  /** share of the group that must be in the tent at all times (1/3 = 0.3333) */
  fraction: number;
}

export interface GroupSettings {
  /** carolina = Black/Blue/White phases; game = non-UNC game, a fraction of the group at all times */
  mode: GroupMode;
  game: GameSettings;
  timezone: string;
  phases: Phase[];
  requirements: Record<TentType, { day: number; night: number }>;
  /** "HH:mm" local time */
  nightStart: string;
  nightEnd: string;
  /** target length of a day shift; shifts can be shorter/longer to fit people's schedules */
  dayShiftHours: number;
  /** shortest shift the scheduler likes to create (it may go shorter if nobody else is free) */
  minShiftHours: number;
  /** 0 or >= night length means one block for the whole night */
  nightShiftHours: number;
  weights: Weights;
  /** max % of tenting hours a person may mark as "can't come" */
  maxBlockedPct: number;
  /** null = no limit */
  maxMembers: number | null;
  /** minutes before a shift to send reminders */
  reminderMinutes: number;
}

export interface Group {
  id: string;
  name: string;
  invite_code: string;
  settings: GroupSettings;
  created_by: string;
  published_at: string | null;
  created_at: string;
}

export interface Profile {
  id: string;
  display_name: string;
  venmo: string | null;
  avatar_url: string | null;
}

export interface Member {
  group_id: string;
  user_id: string;
  role: Role;
  joined_at: string;
  submitted_at: string | null;
  profile: Profile;
}

export interface Availability {
  id: string;
  group_id: string;
  user_id: string;
  start: string;
  end: string;
  kind: AvailabilityKind;
}

export interface SpecialPeriod {
  id: string;
  group_id: string;
  start: string;
  end: string;
  kind: SpecialKind;
  note: string | null;
}

export interface Shift {
  id: string;
  group_id: string;
  start: string;
  end: string;
  user_id: string;
  is_night: boolean;
  /** weighted hours */
  weight: number;
  source: ShiftSource;
  checked_in_at: string | null;
}

export type NewShift = Omit<Shift, "id" | "group_id" | "checked_in_at">;

export interface SwapRequest {
  id: string;
  group_id: string;
  shift_id: string;
  /** part of the shift being handed over; null = the whole shift */
  start: string | null;
  end: string | null;
  from_user: string;
  to_user: string;
  status: "pending" | "accepted" | "declined" | "cancelled";
  created_at: string;
}

export interface ExpenseShare {
  expense_id: string;
  user_id: string;
  amount_cents: number;
  paid_at: string | null;
}

export interface Expense {
  id: string;
  group_id: string;
  title: string;
  total_cents: number;
  buyer_id: string;
  created_at: string;
  shares: ExpenseShare[];
}

export interface GearItem {
  id: string;
  group_id: string;
  name: string;
  assignee_id: string | null;
  done: boolean;
}

export interface Buddy {
  group_id: string;
  user_id: string;
  buddy_id: string;
}

export interface Alert {
  id: string;
  group_id: string;
  created_by: string;
  message: string;
  created_at: string;
}

export interface GroupBundle {
  group: Group;
  members: Member[];
  availability: Availability[];
  specials: SpecialPeriod[];
  shifts: Shift[];
  swaps: SwapRequest[];
  expenses: Expense[];
  gear: GearItem[];
  buddies: Buddy[];
  alerts: Alert[];
}

export interface GroupSummary {
  group: Group;
  role: Role;
  memberCount: number;
}
