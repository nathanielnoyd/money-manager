"use client";

import { startAuthentication } from "@simplewebauthn/browser";
import { Fingerprint, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { api, passkeyErrorMessage } from "@/lib/client-api";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setBusy(true);
    setError(null);
    try {
      const optionsJSON =
        await api<Parameters<typeof startAuthentication>[0]["optionsJSON"]>(
          "/api/auth/login/options",
        );
      const response = await startAuthentication({ optionsJSON });
      await api("/api/auth/login/verify", response);
      const next = params.get("next");
      router.replace(next?.startsWith("/") && !next.startsWith("//") ? next : "/");
      router.refresh();
    } catch (e) {
      setError(passkeyErrorMessage(e));
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-5 p-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Welcome back</h1>
          <p className="mt-1 text-sm text-muted-foreground">Sign in with your passkey.</p>
        </div>
        <Button size="lg" onClick={signIn} disabled={busy} autoFocus>
          {busy ? <Loader2 className="animate-spin" /> : <Fingerprint />}
          Sign in with passkey
        </Button>
        {error && (
          <p role="alert" className="text-sm text-negative">
            {error}
          </p>
        )}
        <Link
          href="/login/recovery"
          className="text-center text-sm text-muted-foreground hover:text-foreground"
        >
          Lost your passkey? Use a recovery code
        </Link>
      </CardContent>
    </Card>
  );
}
