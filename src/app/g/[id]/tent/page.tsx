"use client";
import { DateTime } from "luxon";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { SettingsEditor } from "@/components/SettingsEditor";
import { Avatar, PersonSelect, Section, Sheet, Shapes } from "@/components/ui";
import { useGroup, useSession, useToast } from "@/lib/data/client";
import { fmtDay, fmtRange } from "@/lib/defaults";
import { computeLoads, regenerate } from "@/lib/groupLogic";
import type { SpecialKind } from "@/lib/types";

export default function TentPageWrapper() {
  return (
    <Suspense>
      <TentPage />
    </Suspense>
  );
}

function TentPage() {
  const { bundle, me, isAdmin, run } = useGroup();
  const { api } = useSession();
  const toast = useToast();
  const router = useRouter();
  const welcome = useSearchParams().get("welcome");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [specialOpen, setSpecialOpen] = useState(false);
  const loads = useMemo(() => new Map(computeLoads(bundle).map((l) => [l.userId, l])), [bundle]);
  const link = typeof window !== "undefined" ? `${location.origin}/join/${bundle.group.invite_code}` : "";
  const admins = bundle.members.filter((m) => m.role === "admin").length;
  const s = bundle.group.settings;

  const share = async () => {
    const text = `Join our K-Ville tent "${bundle.group.name}" → ${link}`;
    if (navigator.share) await navigator.share({ title: "K-Ville Tracker", text, url: link }).catch(() => {});
    else {
      await navigator.clipboard.writeText(link);
      toast("Invite link copied");
    }
  };

  return (
    <div className="space-y-7">
      <h1 className="h-display rise text-[40px]">Tent</h1>

      {/* invite */}
      <div className={`rise overflow-hidden rounded-[28px] border ${welcome ? "border-ink bg-lime" : "border-line bg-card"}`}>
        {welcome && <div className="px-5 pt-5 text-lg font-semibold">Group created 🎉 Now invite your tent-mates.</div>}
        <div className="flex items-center justify-between gap-3 p-5">
          <div>
            <p className="label !text-ink/60">Invite code</p>
            <p className="mt-1 font-mono text-[32px] font-semibold tracking-[0.18em]">{bundle.group.invite_code}</p>
            <p className="text-[13px] text-ink-2">
              {bundle.members.length}
              {s.maxMembers ? ` / ${s.maxMembers}` : ""} members{s.maxMembers === null ? " · no limit" : ""}
            </p>
          </div>
          <button className="btn-primary" onClick={share}>
            Share link
          </button>
        </div>
        {!welcome && <Shapes cols={12} seed={5} cell={24} />}
      </div>

      {/* members */}
      <Section title="Members">
        <div className="card divide-y divide-line">
          {bundle.members.map((m) => {
            const l = loads.get(m.user_id);
            return (
              <div key={m.user_id} className="flex items-center gap-3 px-4 py-3">
                <Avatar id={m.user_id} name={m.profile.display_name} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">
                    {m.profile.display_name} {m.user_id === me.user_id && <span className="font-normal text-ink-2">(you)</span>}
                  </p>
                  <p className="font-mono text-[11px] text-muted">
                    {m.role === "admin" ? "ADMIN · " : ""}
                    {l?.total ?? 0} pts · {l?.nights ?? 0} nights · {m.submitted_at ? "times in" : "times pending"}
                  </p>
                </div>
                {isAdmin && m.user_id !== me.user_id && (
                  <MemberMenu
                    name={m.profile.display_name}
                    isAdmin={m.role === "admin"}
                    onRole={() => run(() => api.setRole(bundle.group.id, m.user_id, m.role === "admin" ? "member" : "admin"), "Updated")}
                    onRemove={() =>
                      confirm(`Remove ${m.profile.display_name}? Their future shifts get reassigned when you regenerate.`) &&
                      run(() => api.removeMember(bundle.group.id, m.user_id), "Removed")
                    }
                  />
                )}
              </div>
            );
          })}
        </div>
      </Section>

      {/* grace periods */}
      <Section
        title={s.mode === "game" ? "Rough periods" : "Grace & rough periods"}
        hint={
          s.mode === "game"
            ? "No grace periods for this one. Flag cold or rainy stretches so they count extra."
            : "Grace = nobody needs to be in the tent (games, breaks, bad weather). Rough = counts extra (cold, rain)."
        }
        action={
          isAdmin && (
            <button className="btn-primary btn-sm" onClick={() => setSpecialOpen(true)}>
              + Add
            </button>
          )
        }
      >
        <div className="space-y-2">
          {bundle.specials.map((p) => (
            <div key={p.id} className={`flex items-center gap-3 rounded-[22px] border border-line p-3.5 ${p.kind === "grace" ? "bg-sky" : "bg-card"}`}>
              <span className="text-xl">{p.kind === "grace" ? "🏀" : "❄️"}</span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{p.note || (p.kind === "grace" ? "Grace period" : "Rough conditions")}</p>
                <p className="text-[13px] text-ink-2">
                  {fmtDay(p.start)} {fmtRange(p.start, p.end)} · {p.kind === "grace" ? "no one needed" : `${s.weights.harsh}× weight`}
                </p>
              </div>
              {isAdmin && (
                <button
                  className="btn-ghost btn-sm"
                  aria-label="Delete period"
                  onClick={async () => {
                    await run(() => api.deleteSpecial(p.id), "Removed");
                    if (bundle.group.published_at) {
                      const fresh = await api.getBundle(bundle.group.id);
                      await run(() => regenerate(api, fresh), "Future schedule updated");
                    }
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          {bundle.specials.length === 0 && <p className="card p-4 text-[14px] text-ink-2">None yet.</p>}
        </div>
      </Section>

      <Gear />

      {isAdmin && (
        <Section title="Admin">
          <div className="grid gap-2">
            <button className="btn-ghost w-full" onClick={() => setSettingsOpen(true)}>
              Tent rules, dates & weights
            </button>
            <button
              className="w-full py-2 text-[14px] text-danger underline underline-offset-4"
              onClick={async () => {
                if (!confirm(`Delete "${bundle.group.name}" for everyone? This can't be undone.`)) return;
                await run(() => api.deleteGroup(bundle.group.id));
                router.replace("/");
              }}
            >
              Delete group
            </button>
          </div>
        </Section>
      )}
      {(!isAdmin || admins > 1) && (
        <button
          className="w-full py-2 text-[14px] text-ink-2 underline underline-offset-4"
          onClick={async () => {
            if (!confirm("Leave this group?")) return;
            await run(() => api.removeMember(bundle.group.id, me.user_id));
            router.replace("/");
          }}
        >
          Leave group
        </button>
      )}

      {isAdmin && <SettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} />}
      {isAdmin && <SpecialSheet open={specialOpen} onClose={() => setSpecialOpen(false)} />}
    </div>
  );
}

function MemberMenu({ name, isAdmin, onRole, onRemove }: { name: string; isAdmin: boolean; onRole: () => void; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn-ghost btn-sm" aria-label={`Manage ${name}`} onClick={() => setOpen(true)}>
        •••
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={name}>
        <div className="grid gap-2">
          <button className="btn-ghost w-full" onClick={() => { onRole(); setOpen(false); }}>
            {isAdmin ? "Remove admin" : "Make admin"}
          </button>
          <button className="btn-danger w-full" onClick={() => { onRemove(); setOpen(false); }}>
            Remove from group
          </button>
        </div>
      </Sheet>
    </>
  );
}

function Gear() {
  const { bundle, memberName, run } = useGroup();
  const { api } = useSession();
  const [name, setName] = useState("");
  const done = bundle.gear.filter((g) => g.done).length;
  return (
    <Section title="Gear checklist" hint={`${done}/${bundle.gear.length} packed`}>
      <div className="card divide-y divide-line">
        {bundle.gear.map((g) => (
          <div key={g.id} className="flex items-center gap-3 px-4 py-2.5">
            <button
              aria-label={g.done ? "Mark not packed" : "Mark packed"}
              onClick={() => run(() => api.updateGear(g.id, { done: !g.done }))}
              className={`flex size-6 shrink-0 items-center justify-center rounded-full border-2 ${g.done ? "border-ink bg-lime" : "border-line"}`}
            >
              {g.done && "✓"}
            </button>
            <span className={`min-w-0 flex-1 truncate text-[15px] ${g.done ? "text-muted line-through" : ""}`}>{g.name}</span>
            <PersonSelect
              label={`Who brings ${g.name}`}
              value={g.assignee_id}
              onChange={(v) => run(() => api.updateGear(g.id, { assignee_id: v }))}
              people={bundle.members.map((m) => ({ id: m.user_id, name: memberName(m.user_id) }))}
            />
            <button className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted hover:bg-coral-soft hover:text-danger" aria-label={`Delete ${g.name}`} onClick={() => run(() => api.deleteGear(g.id))}>
              ✕
            </button>
          </div>
        ))}
        <form
          className="flex gap-2 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            run(() => api.addGear(bundle.group.id, name.trim()));
            setName("");
          }}
        >
          <input className="input !py-2" placeholder="Add item (tarp, heater, cards…)" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn-primary btn-sm" disabled={!name.trim()}>
            Add
          </button>
        </form>
      </div>
    </Section>
  );
}

function SettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { bundle, run } = useGroup();
  const { api } = useSession();
  const [draft, setDraft] = useState(bundle.group.settings);
  const [name, setName] = useState(bundle.group.name);
  useEffect(() => {
    if (open) {
      setDraft(bundle.group.settings);
      setName(bundle.group.name);
    }
  }, [open, bundle.group.settings, bundle.group.name]);
  return (
    <Sheet open={open} onClose={onClose} title="Tent rules">
      <label className="mb-5 block">
        <span className="label">Group name</span>
        <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <SettingsEditor value={draft} onChange={setDraft} />
      <div className="sticky bottom-0 -mx-5 mt-6 border-t border-line bg-paper px-5 pt-3">
        <button
          className="btn-primary w-full"
          onClick={async () => {
            await run(() => api.updateGroup(bundle.group.id, { name: name.trim() || bundle.group.name, settings: draft }), "Saved");
            if (bundle.group.published_at && confirm("Regenerate future shifts with the new rules? Past, manual and swapped shifts stay put.")) {
              const fresh = await api.getBundle(bundle.group.id);
              await run(() => regenerate(api, fresh), "Future schedule updated");
              api.notify(bundle.group.id, "all", "Schedule updated", "Tent rules changed. Check your upcoming shifts.");
            }
            onClose();
          }}
        >
          Save
        </button>
      </div>
    </Sheet>
  );
}

function SpecialSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { bundle, run } = useGroup();
  const { api } = useSession();
  const tz = bundle.group.settings.timezone;
  const gameMode = bundle.group.settings.mode === "game";
  const [kind, setKind] = useState<SpecialKind>(gameMode ? "harsh" : "grace");
  const [date, setDate] = useState(DateTime.now().setZone(tz).toISODate()!);
  const [from, setFrom] = useState("18:00");
  const [to, setTo] = useState("23:00");
  const [note, setNote] = useState("");
  const start = DateTime.fromISO(`${date}T${from}`, { zone: tz });
  let end = DateTime.fromISO(`${date}T${to}`, { zone: tz });
  if (end <= start) end = end.plus({ days: 1 });

  return (
    <Sheet open={open} onClose={onClose} title="Add period">
      <div className="mb-4 grid grid-cols-2 gap-2">
        {(
          [
            ["grace", "🏀 Grace", "Nobody needed"],
            ["harsh", "❄️ Rough", "Counts extra"],
          ] as const
        ).filter(([k]) => !gameMode || k === "harsh").map(([k, l, d]) => (
          <button key={k} onClick={() => setKind(k)} className={`rounded-[22px] border p-3 text-left ${kind === k ? "border-ink ring-2 ring-ink" : "border-line"} ${k === "grace" ? "bg-sky" : "bg-card"}`}>
            <p className="font-semibold">{l}</p>
            <p className="text-[12px] text-ink-2">{d}</p>
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="col-span-2">
          <span className="label">Starts on</span>
          <input type="date" className="input mt-1" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          <span className="label">From</span>
          <input type="time" className="input mt-1" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          <span className="label">To</span>
          <input type="time" className="input mt-1" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <input
          className="input col-span-2"
          placeholder={kind === "grace" ? "Reason (e.g. home game vs. Illinois)" : "Reason (e.g. 15°F and snow)"}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <p className="mt-2 text-[12px] text-ink-2">
        {start.toFormat("ccc LLL d, h:mma")} → {end.toFormat("ccc LLL d, h:mma")}
        {bundle.group.published_at && " · future shifts update automatically"}
      </p>
      <button
        className="btn-primary mt-4 w-full"
        onClick={async () => {
          await run(() => api.addSpecial(bundle.group.id, { kind, start: start.toUTC().toISO()!, end: end.toUTC().toISO()!, note: note.trim() || null }), "Added");
          if (bundle.group.published_at) {
            const fresh = await api.getBundle(bundle.group.id);
            await run(() => regenerate(api, fresh), "Future schedule updated");
            api.notify(bundle.group.id, "all", kind === "grace" ? "Grace period added 🏀" : "Rough weather flagged ❄️", `${note || ""} Schedule updated, check your shifts.`.trim());
          }
          setNote("");
          onClose();
        }}
      >
        Add {kind === "grace" ? "grace period" : "rough period"}
      </button>
    </Sheet>
  );
}
