"use client";
import { useEffect, useState } from "react";
import { useSession } from "@/lib/data/client";
import { demoActAs, demoPeople, demoReset } from "@/lib/data/demoApi";
import type { Profile } from "@/lib/types";

/** Only shown when running without Supabase: lets you test as any member. */
export function DemoBar() {
  const { api, userId } = useSession();
  const [people, setPeople] = useState<Profile[]>([]);
  useEffect(() => {
    if (api.mode === "demo") setPeople(demoPeople());
  }, [api.mode, userId]);
  if (api.mode !== "demo" || !userId) return null;
  return (
    <div className="flex items-center justify-between gap-2 bg-ink px-4 py-1.5 font-mono text-[11px] text-paper">
      <span className="flex items-center gap-2">
        <span className="rounded-full bg-lime px-2 py-0.5 font-semibold text-ink">DEMO</span>
        <label className="flex items-center gap-1">
          acting as
          <select
            aria-label="Act as member"
            value={userId}
            onChange={(e) => demoActAs(e.target.value)}
            className="max-w-[130px] rounded bg-paper/10 px-1 py-0.5 text-paper outline-none"
          >
            {people.map((p) => (
              <option key={p.id} value={p.id} className="text-ink">
                {p.display_name}
              </option>
            ))}
          </select>
        </label>
      </span>
      <button
        onClick={() => {
          if (confirm("Reset the demo data?")) {
            demoReset();
            location.href = "/";
          }
        }}
        className="underline underline-offset-2 opacity-70 hover:opacity-100"
      >
        reset
      </button>
    </div>
  );
}
