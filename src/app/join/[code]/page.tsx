"use client";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AuthCard } from "@/components/AuthCard";
import { Logo, Shapes, Spinner } from "@/components/ui";
import { useSession } from "@/lib/data/client";

export default function JoinPage() {
  const { code } = useParams<{ code: string }>();
  const { api, userId, loading } = useSession();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const tried = useRef(false);

  useEffect(() => {
    if (loading || !userId || tried.current) return;
    tried.current = true;
    api.joinGroup(code).then((id) => router.replace(`/g/${id}`)).catch((e) => setError(e.message));
  }, [api, code, loading, router, userId]);

  if (loading || (userId && !error)) return <Spinner />;
  return (
    <main className="mx-auto max-w-md px-4 pt-6">
      <Logo />
      <div className="card mt-10 overflow-hidden">
        <Shapes cols={6} seed={8} />
        <div className="p-6">
          <p className="label">Invite code</p>
          <p className="mt-1 font-mono text-3xl tracking-[0.25em]">{code.toUpperCase()}</p>
          {error ? (
            <p className="mt-4 text-danger">{error}</p>
          ) : (
            <>
              <p className="mb-4 mt-4 text-ink-2">Sign in or create an account to join this tent group.</p>
              <AuthCard />
            </>
          )}
        </div>
      </div>
    </main>
  );
}
