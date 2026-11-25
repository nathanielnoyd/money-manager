"use client";

import { startRegistration } from "@simplewebauthn/browser";
import { Fingerprint, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { RecoveryCodesView } from "@/components/auth/recovery-codes";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { api, passkeyErrorMessage } from "@/lib/client-api";

export function InviteForm({
  token,
  email,
  role,
  householdName,
}: {
  token: string;
  email: string;
  role: string;
  householdName: string;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);

  if (codes) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-4 p-6">
          <h1 className="text-xl font-semibold tracking-tight">Save your recovery codes</h1>
          <p className="text-sm text-muted-foreground">
            If you lose your passkey, these get you back in. Store them somewhere safe. They won't
            be shown again.
          </p>
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
            Continue
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-6">
        <h1 className="text-xl font-semibold tracking-tight">Join {householdName}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          You've been invited as a <strong>{role}</strong>. You'll sign in with a passkey: no
          password.
        </p>
        <form
          className="mt-5 flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              const optionsJSON = await api<Parameters<typeof startRegistration>[0]["optionsJSON"]>(
                "/api/auth/invite/options",
                { token, displayName: name },
              );
              const response = await startRegistration({ optionsJSON });
              const r = await api<{ recoveryCodes: string[] }>("/api/auth/invite/verify", response);
              setCodes(r.recoveryCodes);
            } catch (err) {
              setError(passkeyErrorMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="inv-email">Email</Label>
            <Input id="inv-email" value={email} disabled />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="inv-name">Your name</Label>
            <Input
              id="inv-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={80}
              autoComplete="name"
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-negative">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" disabled={busy || !name.trim()}>
            {busy ? <Loader2 className="animate-spin" /> : <Fingerprint />} Create passkey &amp;
            join
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
