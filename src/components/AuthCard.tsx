"use client";
import { useState } from "react";
import { useSession, useToast } from "@/lib/data/client";

const GOOGLE_ENABLED = process.env.NEXT_PUBLIC_GOOGLE_AUTH === "true";

/** Sign in / create account. Email + password always; Google when enabled. */
export function AuthCard() {
  const { api, refreshProfile } = useSession();
  const toast = useToast();
  const [mode, setMode] = useState<"signin" | "signup">("signup");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  if (api.mode === "demo") {
    return (
      <button onClick={() => api.signIn()} className="btn-primary w-full sm:w-auto">
        Open the demo tent →
      </button>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      if (mode === "signup") {
        const r = await api.signUp(email, password, name);
        if (r === "confirm_email") setNotice(`Check ${email} for a confirmation link, then sign in.`);
      } else await api.signInWithPassword(email, password);
      await refreshProfile();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card w-full max-w-md p-5">
      <div className="mb-4 inline-flex rounded-full border border-line bg-paper p-1">
        {(
          [
            ["signup", "Create account"],
            ["signin", "Sign in"],
          ] as const
        ).map(([m, l]) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`rounded-full px-4 py-1.5 text-[13px] font-semibold transition ${mode === m ? "bg-ink text-paper" : "text-ink-2"}`}
          >
            {l}
          </button>
        ))}
      </div>
      <form onSubmit={submit} className="space-y-2.5">
        {mode === "signup" && (
          <input className="input" placeholder="Your name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required />
        )}
        <input className="input" type="email" placeholder="Email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input
          className="input"
          type="password"
          placeholder={mode === "signup" ? "Password (6+ characters)" : "Password"}
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? "…" : mode === "signup" ? "Create account" : "Sign in"}
        </button>
      </form>
      {notice && <p className="mt-3 rounded-2xl bg-lime-soft p-3 text-[14px]">{notice}</p>}
      {GOOGLE_ENABLED && (
        <>
          <div className="my-4 flex items-center gap-3 text-[12px] text-muted">
            <span className="h-px flex-1 bg-line" />
            or
            <span className="h-px flex-1 bg-line" />
          </div>
          <button type="button" onClick={() => api.signIn()} className="btn-ghost w-full">
            Continue with Google
          </button>
        </>
      )}
      <p className="mt-3 text-[12px] text-ink-2">Testing? Make a few accounts and open each in its own browser or private window.</p>
    </div>
  );
}
