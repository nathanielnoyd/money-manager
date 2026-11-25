"use client";

import { startRegistration } from "@simplewebauthn/browser";
import { Fingerprint, KeyRound, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { RecoveryCodesView } from "@/components/auth/recovery-codes";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { api, passkeyErrorMessage } from "@/lib/client-api";

export function SetupForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const optionsJSON = await api<Parameters<typeof startRegistration>[0]["optionsJSON"]>(
        "/api/auth/setup/options",
        {
          setupToken: String(f.get("setupToken") ?? "").trim(),
          email: f.get("email"),
          displayName: f.get("displayName"),
          householdName: f.get("householdName"),
        },
      );
      const response = await startRegistration({ optionsJSON });
      const { recoveryCodes } = await api<{ recoveryCodes: string[] }>(
        "/api/auth/setup/verify",
        response,
      );
      setCodes(recoveryCodes);
    } catch (err) {
      setError(passkeyErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (codes) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-4 p-6">
          <div className="flex size-10 items-center justify-center rounded-full bg-accent text-accent-foreground">
            <KeyRound className="size-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Save your recovery codes</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              If you lose your passkey, these are the only way back in. Store them in a password
              manager or print them. They won't be shown again.
            </p>
          </div>
          <RecoveryCodesView codes={codes} />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={saved}
              onChange={(e) => setSaved(e.target.checked)}
              className="size-4 accent-[var(--primary)]"
            />
            I've saved these codes somewhere safe
          </label>
          <Button
            disabled={!saved}
            onClick={() => {
              router.replace("/");
              router.refresh();
            }}
          >
            Continue to dashboard
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-6">
        <h1 className="text-xl font-semibold tracking-tight">Set up your instance</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Create the owner account. You'll sign in with a passkey: no passwords.
        </p>
        <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-4">
          <Field
            id="setupToken"
            label="Setup token"
            hint="Printed in the migrate container's logs."
          >
            <Input
              id="setupToken"
              name="setupToken"
              required
              autoComplete="off"
              className="font-mono"
            />
          </Field>
          <Field id="displayName" label="Your name">
            <Input
              id="displayName"
              name="displayName"
              required
              autoComplete="name"
              maxLength={80}
            />
          </Field>
          <Field
            id="email"
            label="Email"
            hint="Used as your passkey username. Nothing is ever emailed."
          >
            <Input id="email" name="email" type="email" required autoComplete="email" />
          </Field>
          <Field id="householdName" label="Household name">
            <Input
              id="householdName"
              name="householdName"
              required
              defaultValue="Our Household"
              maxLength={80}
            />
          </Field>
          {error && (
            <p role="alert" className="text-sm text-negative">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Fingerprint />}
            Create passkey &amp; finish
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
