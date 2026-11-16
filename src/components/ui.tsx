"use client";
import { DateTime } from "luxon";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { TENT_INFO } from "@/lib/defaults";
import type { BadgeKind } from "@/lib/groupLogic";

const PALETTE = ["#c4f041", "#fa8e66", "#bce6fa", "#aac2aa", "#f3bd77", "#e2f298", "#f6d0c7", "#8fd8ff"];
export function colorFor(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
export function initials(name: string) {
  return name
    .replace(/\(.*?\)/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function Avatar({ id, name, size = 32, ring }: { id: string; name: string; size?: number; ring?: string }) {
  return (
    <span
      title={name}
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-ink"
      style={{
        width: size,
        height: size,
        background: colorFor(id),
        fontSize: size * 0.38,
        boxShadow: ring ? `0 0 0 2px var(--color-card), 0 0 0 4px ${ring}` : undefined,
      }}
    >
      {initials(name) || "?"}
    </span>
  );
}

export function AvatarStack({ people, max = 5, size = 28 }: { people: { id: string; name: string }[]; max?: number; size?: number }) {
  const shown = people.slice(0, max);
  return (
    <span className="inline-flex items-center">
      {shown.map((p, i) => (
        <span key={p.id} style={{ marginLeft: i ? -size / 3 : 0 }} className="rounded-full ring-2 ring-card">
          <Avatar id={p.id} name={p.name} size={size} />
        </span>
      ))}
      {people.length > max && (
        <span
          className="inline-flex items-center justify-center rounded-full bg-ink font-mono text-[11px] text-paper ring-2 ring-card"
          style={{ width: size, height: size, marginLeft: -size / 3 }}
        >
          +{people.length - max}
        </span>
      )}
    </span>
  );
}

export function TentBadge({ type, label, className = "" }: { type: BadgeKind; label?: string; className?: string }) {
  const t = TENT_INFO[type];
  return (
    <span
      className={`inline-flex max-w-[160px] items-center gap-1.5 truncate whitespace-nowrap rounded-full border border-ink/15 px-3 py-1 font-mono text-[11px] uppercase tracking-wider ${className}`}
      style={{ background: t.color, color: t.text }}
    >
      <TentGlyph size={11} />
      <span className="truncate">{label ?? `${t.label} tent`}</span>
    </span>
  );
}

/**
 * Horizontal strip of tent days. Mouse-wheel scrolls it sideways on desktop, and the selected
 * day is kept in view.
 */
export function DayStrip({
  days,
  value,
  onChange,
  tz,
  today,
  marker,
  bar,
}: {
  days: string[];
  value: string;
  onChange: (d: string) => void;
  tz: string;
  today: string;
  marker?: (d: string) => boolean;
  bar?: (d: string) => React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>("[data-active=true]");
    el?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [value]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        el.scrollLeft += e.deltaY;
        e.preventDefault();
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  const i = days.indexOf(value);
  return (
    <div className="flex items-center gap-1.5">
      <button
        aria-label="Previous day"
        disabled={i <= 0}
        onClick={() => onChange(days[i - 1])}
        className="hidden size-9 shrink-0 items-center justify-center rounded-full border border-line bg-card disabled:opacity-30 sm:flex"
      >
        ‹
      </button>
      <div ref={ref} className="no-scrollbar -mx-4 flex flex-1 gap-2 overflow-x-auto px-4 py-1 sm:mx-0 sm:px-0">
        {days.map((d) => {
          const dd = DateTime.fromISO(d, { zone: tz });
          const active = d === value;
          const isToday = d === today;
          return (
            <button
              key={d}
              data-active={active}
              onClick={() => onChange(d)}
              className={`relative flex w-[54px] shrink-0 flex-col items-center rounded-[20px] border py-2 transition ${
                active ? "border-ink bg-ink text-paper" : isToday ? "border-coral bg-coral-soft" : "border-line bg-card"
              }`}
            >
              <span className={`font-mono text-[10px] uppercase ${isToday ? "font-bold text-coral" : "opacity-70"} ${active && isToday ? "!text-coral" : ""}`}>
                {isToday ? "Today" : dd.toFormat("ccc")}
              </span>
              <span className="text-lg font-semibold leading-tight">{dd.day}</span>
              {bar?.(d)}
              {marker?.(d) && <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-lime" />}
            </button>
          );
        })}
      </div>
      <button
        aria-label="Next day"
        disabled={i < 0 || i >= days.length - 1}
        onClick={() => onChange(days[i + 1])}
        className="hidden size-9 shrink-0 items-center justify-center rounded-full border border-line bg-card disabled:opacity-30 sm:flex"
      >
        ›
      </button>
    </div>
  );
}

/** Compact person picker: shows an avatar chip, opens the native picker on tap. */
export function PersonSelect({
  value,
  onChange,
  people,
  emptyLabel = "Anyone",
  label,
  allowEmpty = true,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  people: { id: string; name: string }[];
  emptyLabel?: string;
  label: string;
  allowEmpty?: boolean;
}) {
  const cur = people.find((p) => p.id === value);
  return (
    <label className="relative inline-flex h-8 w-[118px] shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-line bg-paper pl-1 pr-6 text-[13px] font-medium transition hover:border-ink">
      {cur ? <Avatar id={cur.id} name={cur.name} size={22} /> : <span className="flex size-[22px] items-center justify-center rounded-full border border-dashed border-muted text-[11px] text-muted">?</span>}
      <span className={`truncate ${cur ? "" : "text-muted"}`}>{cur ? cur.name.split(" ")[0] : emptyLabel}</span>
      <svg className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2" width="10" height="10" viewBox="0 0 10 10" aria-hidden>
        <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <select
        aria-label={label}
        className="absolute inset-0 cursor-pointer opacity-0"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
      >
        {allowEmpty && <option value="">{emptyLabel}</option>}
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function TentGlyph({ size = 16, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <path d="M8 1.5 1 14.5h14z" fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M8 7.5 5.5 14.5h5z" fill={color} />
    </svg>
  );
}

export function Moon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <path d="M13.5 10.2A6 6 0 0 1 5.8 2.5a6 6 0 1 0 7.7 7.7z" fill="currentColor" />
    </svg>
  );
}
export function Sun({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <circle cx="8" cy="8" r="3.2" fill="currentColor" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
        <rect key={a} x="7.4" y="0.6" width="1.2" height="2.6" rx="0.6" fill="currentColor" transform={`rotate(${a} 8 8)`} />
      ))}
    </svg>
  );
}

/** Flat geometric color blocks, loopsii-style. */
export function Shapes({ cols = 6, seed = 1, cell = 44 }: { cols?: number; seed?: number; cell?: number }) {
  const colors = ["#aac2aa", "#fa8e66", "#c4f041", "#bce6fa", "#f3bd77", "#e2f298"];
  const kinds = ["sq", "circle", "tri", "qtr", "half", "diamond"];
  let r = seed * 9973;
  const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  const rows = 2;
  return (
    <svg viewBox={`0 0 ${cols * cell} ${rows * cell}`} className="w-full" aria-hidden>
      {Array.from({ length: cols * rows }, (_, i) => {
        const x = (i % cols) * cell, y = Math.floor(i / cols) * cell;
        const c = colors[Math.floor(rnd() * colors.length)];
        const k = kinds[Math.floor(rnd() * kinds.length)];
        const h = cell / 2;
        switch (k) {
          case "circle": return <circle key={i} cx={x + h} cy={y + h} r={h} fill={c} />;
          case "tri": return <path key={i} d={`M${x} ${y + cell}L${x + cell} ${y + cell}L${x + cell} ${y}z`} fill={c} />;
          case "qtr": return <path key={i} d={`M${x} ${y}h${cell}v${cell}A${cell} ${cell} 0 0 1 ${x} ${y}z`} fill={c} />;
          case "half": return <path key={i} d={`M${x} ${y + cell}V${y + h}a${h} ${h} 0 0 1 ${cell} 0V${y + cell}z`} fill={c} />;
          case "diamond": return <path key={i} d={`M${x + h} ${y}L${x + cell} ${y + h}L${x + h} ${y + cell}L${x} ${y + h}z`} fill={c} />;
          default: return <rect key={i} x={x} y={y} width={cell} height={cell} fill={c} />;
        }
      })}
    </svg>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal aria-label={title}>
      <button aria-label="Close" className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="rise relative max-h-[88dvh] w-full max-w-lg overflow-y-auto rounded-t-[32px] border border-line bg-paper p-5 pb-[max(20px,env(safe-area-inset-bottom))] sm:rounded-[32px]">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line sm:hidden" />
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
          <button onClick={onClose} className="btn-ghost btn-sm" aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Section({ title, hint, action, children, className = "" }: { title: string; hint?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rise ${className}`}>
      <div className="mb-2.5 flex items-end justify-between gap-3 px-1">
        <div>
          <h2 className="label">{title}</h2>
          {hint && <p className="mt-0.5 text-[13px] text-ink-2">{hint}</p>}
        </div>
        {action && <div className="shrink-0 whitespace-nowrap">{action}</div>}
      </div>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="card px-5 py-8 text-center text-[15px] text-ink-2">{children}</div>;
}

export function Spinner() {
  return (
    <div className="flex min-h-[50dvh] items-center justify-center">
      <div className="size-10 animate-spin rounded-full border-[3px] border-line border-t-ink" />
    </div>
  );
}

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2 text-[17px] font-bold tracking-tight">
      <span className="inline-flex size-7 items-center justify-center rounded-full bg-lime">
        <TentGlyph size={14} />
      </span>
      K-Ville<span className="font-normal text-ink-2">tracker</span>
    </Link>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition ${checked ? "bg-ink" : "bg-line"}`}
    >
      <span className={`absolute top-1 size-5 rounded-full transition-all ${checked ? "left-6 bg-lime" : "left-1 bg-card"}`} />
    </button>
  );
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: React.ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-full border border-line bg-card p-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition ${value === o.value ? "bg-ink text-paper" : "text-ink-2"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
