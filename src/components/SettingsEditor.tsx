"use client";
import { defaultGame, fractionLabel, TENT_INFO } from "@/lib/defaults";
import type { GroupSettings, TentType } from "@/lib/types";
import { Seg, Toggle } from "./ui";

const TENTS: TentType[] = ["black", "blue", "white"];

function Num({ label, value, onChange, step = 1, min = 0, suffix }: { label: string; value: number; onChange: (n: number) => void; step?: number; min?: number; suffix?: string }) {
  return (
    <label className="block min-w-0">
      <span className="label">{label}</span>
      <div className="relative mt-1">
        <input
          type="number"
          inputMode="decimal"
          className={`input min-w-0 font-mono ${suffix ? "pr-12" : ""}`}
          value={Number.isFinite(value) ? value : ""}
          step={step}
          min={min}
          onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
        />
        {suffix && <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 font-mono text-[12px] text-muted">{suffix}</span>}
      </div>
    </label>
  );
}

export function SettingsEditor({ value, onChange, showMode = true }: { value: GroupSettings; onChange: (s: GroupSettings) => void; showMode?: boolean }) {
  const set = (patch: Partial<GroupSettings>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-6">
      {showMode && (
      <div>
        <h3 className="mb-2 font-semibold">Tenting type</h3>
        <Seg
          value={value.mode}
          onChange={(mode) => set({ mode, ...(mode === "game" && !value.game?.start ? { game: defaultGame() } : {}) })}
          options={[
            { value: "carolina", label: "Carolina (Black/Blue/White)" },
            { value: "game", label: "Other game" },
          ]}
        />
      </div>
      )}

      {showMode && value.mode === "game" && <GameFields value={value} set={set} />}

      {value.mode === "carolina" && (
      <>
      <div>
        <h3 className="mb-2 font-semibold">Tenting phases</h3>
        <div className="space-y-2">
          {value.phases.map((p, i) => (
            <div key={i} className="card space-y-2 p-3">
              <div className="flex items-center gap-2">
                <select
                  aria-label="Tent type"
                  className="input min-w-0 flex-1 !py-2"
                  value={p.type}
                  onChange={(e) => {
                    const phases = [...value.phases];
                    phases[i] = { ...p, type: e.target.value as TentType };
                    set({ phases });
                  }}
                >
                  {TENTS.map((t) => (
                    <option key={t} value={t}>
                      {TENT_INFO[t].label} tent
                    </option>
                  ))}
                </select>
                <button
                  className="btn-ghost btn-sm"
                  aria-label="Remove phase"
                  disabled={value.phases.length === 1}
                  onClick={() => set({ phases: value.phases.filter((_, j) => j !== i) })}
                >
                  ✕
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(["start", "end"] as const).map((k) => (
                  <label key={k} className="min-w-0">
                    <span className="label">{k === "start" ? "From" : "Through"}</span>
                    <input
                      type="date"
                      className="input mt-1 min-w-0 !px-2 !py-2 text-[14px]"
                      value={p[k]}
                      onChange={(e) => {
                        const phases = [...value.phases];
                        phases[i] = { ...p, [k]: e.target.value };
                        set({ phases });
                      }}
                    />
                  </label>
                ))}
              </div>
            </div>
          ))}
          <button
            className="btn-ghost btn-sm"
            onClick={() => {
              const last = value.phases[value.phases.length - 1];
              set({ phases: [...value.phases, { type: "white", start: last?.end ?? "2027-02-01", end: last?.end ?? "2027-02-07" }] });
            }}
          >
            + Add phase
          </button>
        </div>
      </div>

      <div>
        <h3 className="mb-1 font-semibold">People needed in the tent</h3>
        <p className="mb-2 text-[13px] text-ink-2">Typical K-Ville numbers are filled in. Check this year&apos;s policy.</p>
        <div className="card divide-y divide-line">
          <div className="grid grid-cols-[1fr_80px_80px] gap-2 px-3 py-2">
            <span />
            <span className="label text-center">Day</span>
            <span className="label text-center">Night</span>
          </div>
          {TENTS.map((t) => (
            <div key={t} className="grid grid-cols-[1fr_80px_80px] items-center gap-2 px-3 py-2">
              <span className="w-fit rounded-full px-3 py-1 font-mono text-[11px] uppercase" style={{ background: TENT_INFO[t].color, color: TENT_INFO[t].text, border: "1px solid rgb(28 28 26 / .15)" }}>
                {TENT_INFO[t].label}
              </span>
              {(["day", "night"] as const).map((k) => (
                <input
                  key={k}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  aria-label={`${TENT_INFO[t].label} ${k} people`}
                  className="input min-w-0 !px-2 !py-2 text-center font-mono"
                  value={value.requirements[t][k]}
                  onChange={(e) => set({ requirements: { ...value.requirements, [t]: { ...value.requirements[t], [k]: Math.max(0, Number(e.target.value) || 0) } } })}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      </>
      )}

      <div>
        <h3 className="mb-2 font-semibold">Night hours & shift lengths</h3>
        <div className="grid grid-cols-2 gap-2">
          <label>
            <span className="label">Night starts</span>
            <input type="time" className="input mt-1 min-w-0" value={value.nightStart} onChange={(e) => set({ nightStart: e.target.value })} />
          </label>
          <label>
            <span className="label">Night ends</span>
            <input type="time" className="input mt-1 min-w-0" value={value.nightEnd} onChange={(e) => set({ nightEnd: e.target.value })} />
          </label>
          <Num label="Day shift length" suffix="hrs" step={0.5} value={value.dayShiftHours} onChange={(n) => set({ dayShiftHours: n })} />
          <Num label="Night shift length" suffix="hrs" step={0.5} value={value.nightShiftHours} onChange={(n) => set({ nightShiftHours: n })} />
          <Num label="Shortest shift" suffix="hrs" step={0.25} value={value.minShiftHours} onChange={(n) => set({ minShiftHours: n })} />
        </div>
        <p className="mt-1.5 text-[12px] text-muted">
          Shift lengths are targets: shifts start and end around people&apos;s blocked times (to the 15 min). Night length 0 = whole night.
        </p>
      </div>

      <div>
        <h3 className="mb-1 font-semibold">How hard each hour counts</h3>
        <p className="mb-2 text-[13px] text-ink-2">The scheduler evens out these weighted hours.</p>
        <div className="grid grid-cols-2 gap-2">
          <Num label="Day hour" suffix="×" step={0.25} value={value.weights.day} onChange={(n) => set({ weights: { ...value.weights, day: n } })} />
          <Num label="Weeknight hour" suffix="×" step={0.25} value={value.weights.weeknight} onChange={(n) => set({ weights: { ...value.weights, weeknight: n } })} />
          <Num label="Fri/Sat night hour" suffix="×" step={0.25} value={value.weights.weekendNight} onChange={(n) => set({ weights: { ...value.weights, weekendNight: n } })} />
          <Num label="Cold / rough hour" suffix="×" step={0.25} value={value.weights.harsh} onChange={(n) => set({ weights: { ...value.weights, harsh: n } })} />
        </div>
      </div>

      <div>
        <h3 className="mb-2 font-semibold">Group rules</h3>
        <div className="grid grid-cols-2 gap-2">
          <Num label="Reminder before shift" suffix="min" step={5} value={value.reminderMinutes} onChange={(n) => set({ reminderMinutes: n })} />
        </div>
        <div className="card mt-2 flex items-center justify-between gap-3 p-4">
          <div>
            <p className="font-medium">Member limit</p>
            <p className="text-[13px] text-ink-2">Turn off for big games with no limit.</p>
          </div>
          <div className="flex items-center gap-3">
            {value.maxMembers !== null && (
              <input
                type="number"
                aria-label="Max members"
                className="input w-20 !py-2 font-mono"
                value={value.maxMembers}
                min={1}
                onChange={(e) => set({ maxMembers: Math.max(1, Number(e.target.value) || 1) })}
              />
            )}
            <Toggle label="Member limit" checked={value.maxMembers !== null} onChange={(on) => set({ maxMembers: on ? 12 : null })} />
          </div>
        </div>
      </div>
    </div>
  );
}

function GameFields({ value, set }: { value: GroupSettings; set: (p: Partial<GroupSettings>) => void }) {
  const g = value.game;
  const setG = (patch: Partial<GroupSettings["game"]>) => set({ game: { ...g, ...patch } });
  const fractions = [1 / 4, 1 / 3, 1 / 2];
  return (
    <div className="space-y-2">
      <h3 className="font-semibold">Game details</h3>
      <label className="block">
        <span className="label">Opponent</span>
        <input className="input mt-1" placeholder="Illinois" value={g.opponent} onChange={(e) => setG({ opponent: e.target.value })} />
      </label>
      <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
        <label className="block min-w-0">
          <span className="label">Tenting starts</span>
          <input type="datetime-local" className="input mt-1 min-w-0" value={g.start} onChange={(e) => setG({ start: e.target.value })} />
        </label>
        <label className="block min-w-0">
          <span className="label">Ends (line-up / game)</span>
          <input type="datetime-local" className="input mt-1 min-w-0" value={g.end} onChange={(e) => setG({ end: e.target.value })} />
        </label>
      </div>
      <div>
        <span className="label">Must be in the tent at all times</span>
        <div className="mt-1 flex flex-wrap gap-2">
          {fractions.map((f) => (
            <button
              key={f}
              onClick={() => setG({ fraction: f })}
              className={`chip ${Math.abs(g.fraction - f) < 0.001 ? "!border-ink !bg-lime" : ""}`}
            >
              {fractionLabel(f)} of the group
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[12px] text-ink-2">Rounded up: with 14 people at 1/3, 5 must be there. No Black/Blue/White phases.</p>
      </div>
    </div>
  );
}
