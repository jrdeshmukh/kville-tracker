"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SettingsEditor } from "@/components/SettingsEditor";
import { Logo, Spinner, TentGlyph } from "@/components/ui";
import { useSession, useToast } from "@/lib/data/client";
import { defaultGameSettings, defaultSettings, fractionLabel, TENT_INFO } from "@/lib/defaults";
import type { TentType } from "@/lib/types";

export default function NewGroup() {
  const { api, userId, loading } = useSession();
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState("");
  const [start, setStart] = useState<TentType | "game">("black");
  const [settings, setSettings] = useState(defaultSettings("black"));
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);

  if (loading) return <Spinner />;
  if (!userId) {
    router.replace("/");
    return null;
  }

  const pick = (t: TentType | "game") => {
    setStart(t);
    setSettings(t === "game" ? defaultGameSettings() : defaultSettings(t));
  };

  const create = async () => {
    setBusy(true);
    try {
      const g = await api.createGroup(name.trim(), settings);
      router.replace(`/g/${g.id}/tent?welcome=1`);
    } catch (e) {
      toast((e as Error).message, "error");
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-xl px-4 pb-32 pt-4">
      <header className="flex items-center justify-between">
        <Logo />
        <button className="btn-ghost btn-sm" onClick={() => router.back()}>
          Cancel
        </button>
      </header>
      <h1 className="h-display rise mt-10 text-[44px]">New tent group</h1>
      <p className="mt-2 text-ink-2">You&apos;ll be the admin. Invite the rest with a code or link.</p>

      <label className="mt-8 block">
        <span className="label">Group name</span>
        <input className="input mt-1 text-lg" placeholder="e.g. Section 17 Crazies" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </label>

      <p className="label mt-6">What are you tenting for?</p>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(["black", "blue", "white", "game"] as const).map((t) => (
          <button
            key={t}
            onClick={() => pick(t)}
            className={`rounded-[22px] border p-3 text-left transition ${start === t ? "border-ink ring-2 ring-ink ring-offset-2 ring-offset-paper" : "border-line"}`}
            style={{ background: TENT_INFO[t].color, color: TENT_INFO[t].text }}
          >
            <TentGlyph size={20} />
            <p className="mt-3 font-semibold">{t === "game" ? "Other game" : `UNC · ${TENT_INFO[t].label}`}</p>
            <p className="text-[12px] leading-tight opacity-75">{TENT_INFO[t].blurb}</p>
          </button>
        ))}
      </div>

      {settings.mode === "game" && (
        <div className="mt-6 space-y-2">
          <label className="block">
            <span className="label">Opponent</span>
            <input className="input mt-1" value={settings.game.opponent} onChange={(e) => setSettings({ ...settings, game: { ...settings.game, opponent: e.target.value } })} />
          </label>
          <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
            <label className="block min-w-0">
              <span className="label">Tenting starts</span>
              <input type="datetime-local" className="input mt-1 min-w-0" value={settings.game.start} onChange={(e) => setSettings({ ...settings, game: { ...settings.game, start: e.target.value } })} />
            </label>
            <label className="block min-w-0">
              <span className="label">Ends (line-up / game)</span>
              <input type="datetime-local" className="input mt-1 min-w-0" value={settings.game.end} onChange={(e) => setSettings({ ...settings, game: { ...settings.game, end: e.target.value } })} />
            </label>
          </div>
        </div>
      )}

      <div className="card mt-6 p-4 text-[14px] text-ink-2">
        {settings.mode === "game" ? (
          <p>
            <b className="text-ink">Rule:</b> {fractionLabel(settings.game.fraction)} of the group in the tent at all times, day and night. No
            Black/Blue/White, no member limit. Shifts aim for {settings.dayShiftHours}h by day and the whole night at night, bending around classes.
          </p>
        ) : (
          <p>
            <b className="text-ink">Presets:</b>{" "}
            {settings.phases.map((p) => `${TENT_INFO[p.type].label} ${p.start.slice(5)} → ${p.end.slice(5)}`).join(" · ")}. Nights{" "}
            {settings.nightStart}–{settings.nightEnd}, about {settings.dayShiftHours}h day shifts that bend around classes, whole-night night shifts.
          </p>
        )}
        <button className="mt-2 font-semibold text-ink underline underline-offset-4" onClick={() => setAdvanced((a) => !a)}>
          {advanced ? "Hide" : "Adjust"} dates, head counts & weights
        </button>
      </div>
      {advanced && (
        <div className="mt-4">
          <SettingsEditor value={settings} onChange={setSettings} showMode={false} />
        </div>
      )}

      <div className="fixed inset-x-0 bottom-0 border-t border-line bg-paper/90 px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
        <div className="mx-auto max-w-xl">
          <button className="btn-primary w-full" disabled={!name.trim() || busy} onClick={create}>
            Create group
          </button>
        </div>
      </div>
    </main>
  );
}
