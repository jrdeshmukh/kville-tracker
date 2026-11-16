import type {
  AvailabilityKind,
  GearItem,
  Group,
  GroupBundle,
  GroupSettings,
  GroupSummary,
  NewShift,
  Profile,
  Role,
  SpecialKind,
} from "../types";

export interface Range {
  start: string;
  end: string;
  kind: AvailabilityKind;
}

export interface DataApi {
  mode: "supabase" | "demo";
  // auth
  currentUserId(): Promise<string | null>;
  /** Google OAuth (or "enter demo" in demo mode) */
  signIn(): Promise<void>;
  /** email + password accounts (handy for test accounts) */
  signInWithPassword(email: string, password: string): Promise<void>;
  /** returns "signed_in", or "confirm_email" if the project requires email confirmation */
  signUp(email: string, password: string, name: string): Promise<"signed_in" | "confirm_email">;
  signOut(): Promise<void>;
  onAuthChange(cb: () => void): () => void;
  // profile
  getProfile(): Promise<Profile | null>;
  updateProfile(patch: Partial<Pick<Profile, "display_name" | "venmo">>): Promise<void>;
  calendarFeedUrl(): Promise<string | null>;
  // groups
  listMyGroups(): Promise<GroupSummary[]>;
  createGroup(name: string, settings: GroupSettings): Promise<Group>;
  joinGroup(code: string): Promise<string>;
  getBundle(groupId: string): Promise<GroupBundle>;
  updateGroup(groupId: string, patch: Partial<Pick<Group, "name" | "settings" | "published_at">>): Promise<void>;
  deleteGroup(groupId: string): Promise<void>;
  setRole(groupId: string, userId: string, role: Role): Promise<void>;
  removeMember(groupId: string, userId: string): Promise<void>;
  markSubmitted(groupId: string, done: boolean): Promise<void>;
  // availability
  replaceMyAvailability(groupId: string, ranges: Range[]): Promise<void>;
  // special periods
  addSpecial(groupId: string, p: { start: string; end: string; kind: SpecialKind; note: string | null }): Promise<void>;
  deleteSpecial(id: string): Promise<void>;
  // shifts
  replaceFutureShifts(groupId: string, fromIso: string, shifts: NewShift[]): Promise<void>;
  addShift(groupId: string, s: NewShift): Promise<void>;
  deleteShift(id: string): Promise<void>;
  /** admin: give the whole shift, or just [range], to userId */
  reassignShift(id: string, userId: string, range?: { start: string; end: string }): Promise<void>;
  checkIn(shiftId: string): Promise<void>;
  // swaps
  requestSwap(groupId: string, shiftId: string, fromUser: string, toUser: string, range?: { start: string; end: string }): Promise<void>;
  respondSwap(swapId: string, accept: boolean): Promise<void>;
  cancelSwap(swapId: string): Promise<void>;
  // money
  createExpense(
    groupId: string,
    e: { title: string; total_cents: number; buyer_id: string; shares: { user_id: string; amount_cents: number }[] },
  ): Promise<void>;
  deleteExpense(id: string): Promise<void>;
  setBuyer(expenseId: string, buyerId: string): Promise<void>;
  setPaid(expenseId: string, userId: string, paid: boolean): Promise<void>;
  // gear
  addGear(groupId: string, name: string): Promise<void>;
  updateGear(id: string, patch: Partial<Pick<GearItem, "name" | "assignee_id" | "done">>): Promise<void>;
  deleteGear(id: string): Promise<void>;
  // buddies
  setBuddies(groupId: string, buddyIds: string[]): Promise<void>;
  // alerts + push
  sendAlert(groupId: string, message: string): Promise<void>;
  notify(groupId: string, userIds: string[] | "all", title: string, body: string): Promise<void>;
  savePushSubscription(sub: PushSubscriptionJSON): Promise<void>;
  // realtime
  subscribe(groupId: string, onChange: () => void): () => void;
}
