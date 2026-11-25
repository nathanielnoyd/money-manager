"use client";

import { startRegistration } from "@simplewebauthn/browser";
import {
  Fingerprint,
  KeyRound,
  Laptop,
  Loader2,
  Plus,
  ShieldCheck,
  Smartphone,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { RecoveryCodesView } from "@/components/auth/recovery-codes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api, passkeyErrorMessage } from "@/lib/client-api";
import { withStepUp } from "@/lib/step-up";

interface Props {
  recovered: boolean;
  passkeys: {
    id: string;
    nickname: string;
    createdAt: string;
    lastUsedAt: string | null;
    backedUp: boolean;
  }[];
  totpEnabled: boolean;
  recoveryCodesRemaining: number;
  sessions: { current: boolean; userAgent: string | null; lastSeenAt: string }[];
}

export function SecuritySettings(props: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [totpSetup, setTotpSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [totpCode, setTotpCode] = useState("");

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try {
      await withStepUp(fn);
      router.refresh();
    } catch (e) {
      setError(passkeyErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const addPasskey = () =>
    run("add", async () => {
      const optionsJSON = await api<Parameters<typeof startRegistration>[0]["optionsJSON"]>(
        "/api/auth/passkeys/options",
      );
      const response = await startRegistration({ optionsJSON });
      const nickname =
        window.prompt("Name this passkey (e.g. “MacBook Touch ID”)", "Passkey") ?? "Passkey";
      await api("/api/auth/passkeys/verify", { response, nickname });
    });

  return (
    <div className="flex flex-col gap-4">
      {props.recovered && (
        <div className="rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">
          You signed in with a recovery code. Add a new passkey now, and consider regenerating your
          recovery codes.
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-negative/30 bg-negative/10 p-4 text-sm text-negative"
        >
          {error}
        </div>
      )}

      <Section
        icon={Fingerprint}
        title="Passkeys"
        body="Your primary way to sign in. Add one per device."
      >
        <ul className="divide-y">
          {props.passkeys.map((p) => (
            <li key={p.id} className="flex items-center gap-3 py-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {p.nickname}
                  {p.backedUp && <Badge tone="accent">Synced</Badge>}
                </div>
                <div className="text-xs text-muted-foreground">
                  Added {fmt(p.createdAt)} ·{" "}
                  {p.lastUsedAt ? `last used ${fmt(p.lastUsedAt)}` : "never used"}
                </div>
              </div>
              {props.passkeys.length > 1 && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${p.nickname}`}
                  disabled={busy !== null}
                  onClick={() =>
                    window.confirm(`Remove “${p.nickname}”?`) &&
                    run(`del-${p.id}`, () =>
                      api(`/api/auth/passkeys/${p.id}`, undefined, "DELETE").then(() => {}),
                    )
                  }
                >
                  {busy === `del-${p.id}` ? <Loader2 className="animate-spin" /> : <Trash2 />}
                </Button>
              )}
            </li>
          ))}
        </ul>
        <Button variant="outline" className="mt-2" onClick={addPasskey} disabled={busy !== null}>
          {busy === "add" ? <Loader2 className="animate-spin" /> : <Plus />} Add a passkey
        </Button>
      </Section>

      <Section
        icon={ShieldCheck}
        title="Authenticator app"
        body="Optional. When enabled, recovery-code sign-in also requires a 6-digit code."
        badge={props.totpEnabled ? <Badge tone="accent">Enabled</Badge> : <Badge>Off</Badge>}
      >
        {totpSetup ? (
          <div className="flex flex-col gap-4 sm:flex-row">
            {/* biome-ignore lint/performance/noImgElement: data URL QR code */}
            <img
              src={totpSetup.qr}
              alt="Scan with your authenticator app"
              className="size-44 rounded-lg border bg-white p-2"
            />
            <div className="flex flex-1 flex-col gap-3 text-sm">
              <p className="text-muted-foreground">Scan the code, or enter this key manually:</p>
              <code className="break-all rounded bg-muted px-2 py-1 font-mono text-xs">
                {totpSetup.secret}
              </code>
              <div className="flex gap-2">
                <Input
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                  placeholder="123456"
                  inputMode="numeric"
                  maxLength={6}
                  className="w-32 font-mono"
                />
                <Button
                  disabled={busy !== null || totpCode.length !== 6}
                  onClick={() =>
                    run("totp-confirm", async () => {
                      await api("/api/auth/totp/confirm", { code: totpCode });
                      setTotpSetup(null);
                      setTotpCode("");
                    })
                  }
                >
                  Verify
                </Button>
              </div>
            </div>
          </div>
        ) : props.totpEnabled ? (
          <Button
            variant="outline"
            disabled={busy !== null}
            onClick={() =>
              window.confirm("Turn off the authenticator app?") &&
              run("totp-off", () => api("/api/auth/totp", undefined, "DELETE").then(() => {}))
            }
          >
            Turn off
          </Button>
        ) : (
          <Button
            variant="outline"
            disabled={busy !== null}
            onClick={() =>
              run("totp-setup", async () => setTotpSetup(await api("/api/auth/totp/setup")))
            }
          >
            {busy === "totp-setup" && <Loader2 className="animate-spin" />} Set up
          </Button>
        )}
      </Section>

      <Section
        icon={KeyRound}
        title="Recovery codes"
        body="Single-use codes to get back in if you lose every passkey."
        badge={
          <Badge tone={props.recoveryCodesRemaining < 4 ? "warning" : "neutral"}>
            {props.recoveryCodesRemaining} left
          </Badge>
        }
      >
        {codes ? (
          <RecoveryCodesView codes={codes} />
        ) : (
          <Button
            variant="outline"
            disabled={busy !== null}
            onClick={() =>
              window.confirm("Generate new codes? Your old codes will stop working.") &&
              run("codes", async () =>
                setCodes(
                  (await api<{ recoveryCodes: string[] }>("/api/auth/recovery-codes"))
                    .recoveryCodes,
                ),
              )
            }
          >
            Generate new codes
          </Button>
        )}
      </Section>

      <Section
        icon={Laptop}
        title="Sessions"
        body="Devices currently signed in. Sessions expire after 12 hours idle or 30 days."
      >
        <ul className="divide-y">
          {props.sessions.map((x) => (
            <li
              key={x.lastSeenAt + (x.userAgent ?? "")}
              className="flex items-center gap-3 py-3 text-sm"
            >
              {/mobile|iphone|android/i.test(x.userAgent ?? "") ? (
                <Smartphone className="size-4 text-muted-foreground" />
              ) : (
                <Laptop className="size-4 text-muted-foreground" />
              )}
              <div className="flex-1">
                <div className="font-medium">{describeAgent(x.userAgent)}</div>
                <div className="text-xs text-muted-foreground">Active {fmt(x.lastSeenAt)}</div>
              </div>
              {x.current && <Badge tone="accent">This device</Badge>}
            </li>
          ))}
        </ul>
        {props.sessions.length > 1 && (
          <Button
            variant="outline"
            className="mt-2"
            disabled={busy !== null}
            onClick={() =>
              run("revoke", () => api("/api/auth/sessions", undefined, "DELETE").then(() => {}))
            }
          >
            Sign out other devices
          </Button>
        )}
      </Section>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  body,
  badge,
  children,
}: {
  icon: typeof Fingerprint;
  title: string;
  body: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-start gap-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <Icon className="size-5" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 font-semibold">
            {title} {badge}
          </div>
          <p className="text-sm text-muted-foreground">{body}</p>
        </div>
      </CardHeader>
      <CardContent className="pl-[4.75rem]">{children}</CardContent>
    </Card>
  );
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

function describeAgent(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
      ? "Chrome"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  const os = /iPhone|iPad/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Mac OS X/.test(ua)
        ? "macOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return os ? `${browser} on ${os}` : browser;
}
