"use client";

import type { Scope } from "@mm/services";
import { Check, Copy, KeyRound, Loader2, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Select } from "@/components/ui/fields";
import { Input } from "@/components/ui/input";
import { passkeyErrorMessage } from "@/lib/client-api";
import { actionWithStepUp } from "@/lib/step-up";
import { createAgentToken, revokeAgentToken } from "./actions";

type Role = "owner" | "member" | "viewer";
type ScopeId = Scope;

interface Token {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  maxRole: Role;
  expiresAt: string;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  createdAt: string;
  userId: string;
  createdBy: string;
}

interface Props {
  endpoint: string;
  accessMode: "tailscale" | "cloudflare" | "none";
  demo: boolean;
  me: { userId: string; role: Role };
  scopes: { id: ScopeId; label: string; description: string }[];
  tokens: Token[];
}

const date = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

export function AgentsView({ endpoint, accessMode, demo, me, scopes, tokens }: Props) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ token: string; name: string } | null>(null);
  const isViewer = me.role === "viewer";

  const [name, setName] = useState("Claude Code");
  const [chosen, setChosen] = useState<ScopeId[]>(
    isViewer ? ["read"] : ["read", "transactions:write"],
  );
  const [expires, setExpires] = useState<7 | 30 | 90 | 365>(90);

  const create = () =>
    start(async () => {
      setError(null);
      try {
        const r = await actionWithStepUp(() =>
          createAgentToken({
            name,
            scopes: chosen,
            maxRole: isViewer ? "viewer" : "member",
            expiresInDays: expires,
          }),
        );
        if (!r.ok) setError(r.error);
        else if (r.data) setCreated({ token: r.data.token, name });
      } catch (e) {
        setError(passkeyErrorMessage(e));
      }
    });

  const revoke = (t: Token) =>
    window.confirm(`Revoke "${t.name}"? Agents using it stop working immediately.`) &&
    start(async () => {
      setError(null);
      const r = await revokeAgentToken(t.id);
      if (!r.ok) setError(r.error);
    });

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-negative/30 bg-negative/10 p-3 text-sm text-negative"
        >
          {error}
        </div>
      )}

      {created && <NewToken {...created} endpoint={endpoint} accessMode={accessMode} />}

      <Card>
        <CardHeader>
          <h2 className="font-semibold">Create a token</h2>
          <p className="text-sm text-muted-foreground">
            A token lets an agent act as you, limited to the permissions you pick. It can never link
            banks, manage members, change security settings or export your data. Every change it
            makes is recorded in the audit log.
          </p>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              create();
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" htmlFor="t-name" hint="So you can tell tokens apart.">
                <Input
                  id="t-name"
                  value={name}
                  maxLength={60}
                  onChange={(e) => setName(e.target.value)}
                  disabled={demo || pending}
                />
              </Field>
              <Field label="Expires after" htmlFor="t-exp">
                <Select
                  id="t-exp"
                  value={expires}
                  onChange={(e) => setExpires(Number(e.target.value) as typeof expires)}
                  disabled={demo || pending}
                >
                  <option value={7}>7 days</option>
                  <option value={30}>30 days</option>
                  <option value={90}>90 days</option>
                  <option value={365}>1 year</option>
                </Select>
              </Field>
            </div>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Permissions</legend>
              {scopes.map((s) => {
                const locked = s.id === "read" || isViewer;
                return (
                  <label key={s.id} className="flex items-start gap-3 text-sm">
                    <Checkbox
                      className="mt-0.5"
                      checked={chosen.includes(s.id)}
                      disabled={locked || demo || pending}
                      onChange={(e) =>
                        setChosen((c) =>
                          e.target.checked ? [...c, s.id] : c.filter((x) => x !== s.id),
                        )
                      }
                      aria-label={s.label}
                    />
                    <span>
                      <span className="font-medium">{s.label}</span>
                      <span className="block text-muted-foreground">{s.description}</span>
                    </span>
                  </label>
                );
              })}
              {isViewer && (
                <p className="text-xs text-muted-foreground">
                  You have view-only access, so your tokens are read-only.
                </p>
              )}
            </fieldset>
            <div>
              <Button type="submit" disabled={demo || pending || !name.trim()}>
                {pending ? <Loader2 className="animate-spin" /> : <KeyRound />}
                Create token
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="font-semibold">Active tokens</h2>
        </CardHeader>
        <CardContent>
          {tokens.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active tokens.</p>
          ) : (
            <ul className="divide-y">
              {tokens.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">
                      {t.name} <code className="text-xs text-muted-foreground">{t.prefix}…</code>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t.userId === me.userId ? "You" : t.createdBy} · expires {date(t.expiresAt)} ·{" "}
                      {t.lastUsedAt ? `last used ${date(t.lastUsedAt)}` : "never used"}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {t.scopes.map((s) => (
                        <Badge key={s} tone={s === "read" ? "neutral" : "accent"}>
                          {s}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Revoke ${t.name}`}
                    disabled={pending}
                    onClick={() => revoke(t)}
                  >
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function NewToken({
  token,
  name,
  endpoint,
  accessMode,
}: {
  token: string;
  name: string;
  endpoint: string;
  accessMode: Props["accessMode"];
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const command = `claude mcp add --transport http money-manager ${endpoint} --header "Authorization: Bearer ${token}"${
    accessMode === "cloudflare"
      ? ` --header "CF-Access-Client-Id: <service token id>" --header "CF-Access-Client-Secret: <service token secret>"`
      : ""
  }`;
  const copy = async (label: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };
  return (
    <Card className="border-primary/40">
      <CardHeader>
        <h2 className="font-semibold">Token "{name}" created</h2>
        <p className="text-sm text-muted-foreground">
          Copy it now. It won't be shown again. Treat it like a password: anyone with it can read
          this household's finances.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <CopyRow
          label="Token"
          value={token}
          copied={copied === "token"}
          onCopy={() => copy("token", token)}
        />
        <CopyRow
          label="Claude Code"
          value={command}
          copied={copied === "cmd"}
          onCopy={() => copy("cmd", command)}
        />
        <p className="text-xs text-muted-foreground">
          Run the command on a device that can reach this server
          {accessMode === "tailscale" ? " (one on your tailnet)" : ""}. Other MCP clients: use the
          endpoint <code>{endpoint}</code> with the header <code>Authorization: Bearer …</code>. See
          docs/agents.md.
        </p>
      </CardContent>
    </Card>
  );
}

function CopyRow({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex items-start gap-2">
        <code
          data-testid={`copy-${label.toLowerCase().replace(/\s+/g, "-")}`}
          className="min-w-0 flex-1 break-all rounded-lg bg-muted px-3 py-2 text-xs"
        >
          {value}
        </code>
        <Button variant="outline" size="icon" aria-label={`Copy ${label}`} onClick={onCopy}>
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
    </div>
  );
}
