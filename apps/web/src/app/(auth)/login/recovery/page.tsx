"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { api } from "@/lib/client-api";

export default function RecoveryPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/recovery", {
        email: form.get("email"),
        code: form.get("code"),
        totp: form.get("totp") || undefined,
      });
      router.replace("/settings/security?recovered=1");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="p-6">
        <h1 className="text-xl font-semibold tracking-tight">Use a recovery code</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Each code works once. After signing in, add a new passkey.
        </p>
        <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="username" required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="code">Recovery code</Label>
            <Input
              id="code"
              name="code"
              placeholder="XXXX-XXXX-XXXX"
              autoComplete="off"
              required
              className="font-mono uppercase"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="totp">
              Authenticator code{" "}
              <span className="font-normal text-muted-foreground">(if enabled)</span>
            </Label>
            <Input
              id="totp"
              name="totp"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              autoComplete="one-time-code"
              className="font-mono"
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-negative">
              {error}
            </p>
          )}
          <Button type="submit" disabled={busy}>
            {busy && <Loader2 className="animate-spin" />}
            Sign in
          </Button>
          <Link
            href="/login"
            className="text-center text-sm text-muted-foreground hover:text-foreground"
          >
            Back to passkey sign-in
          </Link>
        </form>
      </CardContent>
    </Card>
  );
}
