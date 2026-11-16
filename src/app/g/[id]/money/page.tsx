"use client";
import { useMemo, useState } from "react";
import { Avatar, Empty, PersonSelect, Section, Sheet } from "@/components/ui";
import { useGroup, useSession } from "@/lib/data/client";
import { money } from "@/lib/defaults";
import { balances } from "@/lib/groupLogic";
import type { Expense } from "@/lib/types";

function venmoUrl(handle: string, cents: number, note: string) {
  const h = handle.replace(/^@/, "");
  return `https://venmo.com/${encodeURIComponent(h)}?txn=pay&amount=${(cents / 100).toFixed(2)}&note=${encodeURIComponent(note)}`;
}

export default function MoneyPage() {
  const { bundle, me, isAdmin, member, memberName } = useGroup();
  const [adding, setAdding] = useState(false);
  const owed = useMemo(() => balances(bundle), [bundle]);
  const iOwe = [...(owed.get(me.user_id) ?? new Map()).entries()];
  const iOweTotal = iOwe.reduce((a, [, c]) => a + c, 0);
  const owedToMe = [...owed.entries()].flatMap(([debtor, m]) => (m.get(me.user_id) ? [[debtor, m.get(me.user_id)!] as const] : []));
  const owedToMeTotal = owedToMe.reduce((a, [, c]) => a + c, 0);
  const groupTotal = bundle.expenses.reduce((a, e) => a + e.total_cents, 0);
  const unpaidTotal = [...owed.values()].reduce((a, m) => a + [...m.values()].reduce((x, y) => x + y, 0), 0);

  return (
    <div className="space-y-6">
      <div className="rise flex items-end justify-between gap-3">
        <h1 className="h-display text-[40px]">Money</h1>
        {isAdmin && (
          <button className="btn-primary btn-sm" onClick={() => setAdding(true)}>
            + Expense
          </button>
        )}
      </div>

      <div className="rise grid grid-cols-2 gap-2">
        <div className={`rounded-[28px] p-5 ${iOweTotal ? "bg-coral" : "bg-lime"}`}>
          <p className="label !text-ink/60">You owe</p>
          <p className="h-display mt-2 text-[34px]">{money(iOweTotal)}</p>
        </div>
        <div className="card p-5">
          <p className="label">Owed to you</p>
          <p className="h-display mt-2 text-[34px]">{money(owedToMeTotal)}</p>
        </div>
      </div>

      {iOwe.length > 0 && (
        <Section title="Pay back">
          <div className="space-y-2">
            {iOwe.map(([to, cents]) => {
              const m = member(to);
              return (
                <div key={to} className="card flex items-center gap-3 p-3">
                  <Avatar id={to} name={memberName(to)} size={36} />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{memberName(to)}</p>
                    <p className="font-mono text-[13px] text-ink-2">{money(cents)}</p>
                  </div>
                  {m?.profile.venmo ? (
                    <a className="btn-primary btn-sm" href={venmoUrl(m.profile.venmo, cents, `K-Ville · ${bundle.group.name}`)} target="_blank" rel="noreferrer">
                      Venmo
                    </a>
                  ) : (
                    <span className="text-[12px] text-muted">no Venmo set</span>
                  )}
                </div>
              );
            })}
          </div>
          <p className="mt-2 px-1 text-[12px] text-ink-2">The buyer marks you as paid once they get it.</p>
        </Section>
      )}

      <Section title="Expenses" hint={`${money(groupTotal)} total · ${money(unpaidTotal)} still out`}>
        <div className="space-y-3">
          {bundle.expenses.map((e) => (
            <ExpenseCard key={e.id} e={e} />
          ))}
          {bundle.expenses.length === 0 && <Empty>No expenses yet. {isAdmin ? "Add the tent, heater, tarps…" : "Your admin adds them here."}</Empty>}
        </div>
      </Section>

      {isAdmin && <AddExpense open={adding} onClose={() => setAdding(false)} />}
    </div>
  );
}

function ExpenseCard({ e }: { e: Expense }) {
  const { bundle, me, isAdmin, memberName, run } = useGroup();
  const { api } = useSession();
  const canMark = isAdmin || e.buyer_id === me.user_id;
  const paidCount = e.shares.filter((s) => s.paid_at || s.user_id === e.buyer_id).length;
  const pct = e.shares.length ? paidCount / e.shares.length : 1;
  const myShare = e.shares.find((s) => s.user_id === me.user_id);
  return (
    <div className="card rise overflow-hidden">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold tracking-tight">{e.title}</p>
            <p className="text-[13px] text-ink-2">
              Bought by <b className="text-ink">{memberName(e.buyer_id)}</b>
              {myShare && e.buyer_id !== me.user_id && <> · your share {money(myShare.amount_cents)}</>}
            </p>
          </div>
          <p className="h-display shrink-0 text-2xl">{money(e.total_cents)}</p>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line-2">
          <div className="h-full rounded-full bg-ok" style={{ width: `${pct * 100}%` }} />
        </div>
        <p className="mt-1 font-mono text-[11px] text-muted">
          {paidCount}/{e.shares.length} paid {canMark && "· tap a name to mark paid"}
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {e.shares.map((s) => {
            const paid = !!s.paid_at || s.user_id === e.buyer_id;
            const isBuyer = s.user_id === e.buyer_id;
            return (
              <button
                key={s.user_id}
                disabled={!canMark || isBuyer}
                onClick={() => run(() => api.setPaid(e.id, s.user_id, !s.paid_at))}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] font-semibold transition disabled:cursor-default ${
                  paid ? "border-ok/30 bg-ok/10 text-ok" : "border-danger/30 bg-danger/10 text-danger"
                }`}
                title={paid ? "Paid" : `Owes ${money(s.amount_cents)}`}
              >
                {paid ? "✓" : "●"} {memberName(s.user_id).split(" ")[0]}
                <span className="font-mono text-[11px] font-normal opacity-80">{isBuyer ? "buyer" : money(s.amount_cents)}</span>
              </button>
            );
          })}
        </div>
      </div>
      {isAdmin && (
        <div className="flex items-center gap-2 border-t border-line bg-paper/60 px-4 py-2.5">
          <span className="flex flex-1 items-center gap-2 text-[13px] text-ink-2">
            Buyer
            <PersonSelect
              label="Change buyer"
              allowEmpty={false}
              value={e.buyer_id}
              onChange={(v) => v && run(() => api.setBuyer(e.id, v), "Buyer updated")}
              people={bundle.members.map((m) => ({ id: m.user_id, name: m.profile.display_name }))}
            />
          </span>
          <button className="text-[13px] text-danger underline underline-offset-2" onClick={() => confirm(`Delete "${e.title}"?`) && run(() => api.deleteExpense(e.id), "Deleted")}>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

function AddExpense({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { bundle, me, run } = useGroup();
  const { api } = useSession();
  const [title, setTitle] = useState("");
  const [total, setTotal] = useState("");
  const [buyer, setBuyer] = useState(me.user_id);
  const [who, setWho] = useState<string[]>(() => bundle.members.map((m) => m.user_id));
  const [custom, setCustom] = useState(false);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const totalCents = Math.round((parseFloat(total) || 0) * 100);

  const shares = useMemo(() => {
    if (custom) return who.map((u) => ({ user_id: u, amount_cents: Math.round((parseFloat(amounts[u] ?? "") || 0) * 100) }));
    const n = who.length || 1;
    const each = Math.floor(totalCents / n);
    let rem = totalCents - each * n;
    return who.map((u) => ({ user_id: u, amount_cents: each + (rem-- > 0 ? 1 : 0) }));
  }, [custom, who, amounts, totalCents]);
  const sum = shares.reduce((a, s) => a + s.amount_cents, 0);
  const valid = title.trim() && totalCents > 0 && who.length > 0 && sum === totalCents;

  return (
    <Sheet open={open} onClose={onClose} title="New expense">
      <div className="space-y-3">
        <input className="input" placeholder="What was bought? (e.g. Propane, tent)" value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <label>
            <span className="label">Total $</span>
            <input className="input mt-1 font-mono" inputMode="decimal" placeholder="0.00" value={total} onChange={(e) => setTotal(e.target.value)} />
          </label>
          <label>
            <span className="label">Paid by</span>
            <select className="input mt-1" value={buyer} onChange={(e) => setBuyer(e.target.value)}>
              {bundle.members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.profile.display_name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex items-center justify-between">
          <span className="label">Split between</span>
          <button className="text-[13px] font-semibold underline underline-offset-4" onClick={() => setCustom((c) => !c)}>
            {custom ? "Split evenly" : "Custom amounts"}
          </button>
        </div>
        <div className="space-y-1.5">
          {bundle.members.map((m) => {
            const on = who.includes(m.user_id);
            const share = shares.find((s) => s.user_id === m.user_id);
            return (
              <div key={m.user_id} className={`flex items-center gap-3 rounded-2xl border px-3 py-2 ${on ? "border-ink bg-card" : "border-line opacity-60"}`}>
                <input
                  type="checkbox"
                  className="size-4 accent-ink"
                  checked={on}
                  onChange={() => setWho((w) => (on ? w.filter((x) => x !== m.user_id) : [...w, m.user_id]))}
                  aria-label={`Include ${m.profile.display_name}`}
                />
                <span className="flex-1 text-[15px]">{m.profile.display_name}</span>
                {on &&
                  (custom ? (
                    <input
                      className="w-24 rounded-xl border border-line bg-paper px-2 py-1 text-right font-mono text-[14px]"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={amounts[m.user_id] ?? ""}
                      onChange={(e) => setAmounts((a) => ({ ...a, [m.user_id]: e.target.value }))}
                    />
                  ) : (
                    <span className="font-mono text-[14px]">{money(share?.amount_cents ?? 0)}</span>
                  ))}
              </div>
            );
          })}
        </div>
        {custom && sum !== totalCents && (
          <p className="text-[13px] text-danger">
            Shares add up to {money(sum)}, total is {money(totalCents)}.
          </p>
        )}
        <button
          className="btn-primary w-full"
          disabled={!valid}
          onClick={async () => {
            await run(() => api.createExpense(bundle.group.id, { title: title.trim(), total_cents: totalCents, buyer_id: buyer, shares }), "Expense added");
            setTitle("");
            setTotal("");
            onClose();
          }}
        >
          Add expense
        </button>
      </div>
    </Sheet>
  );
}
