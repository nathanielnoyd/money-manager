"use client";

import { Check, Copy, Loader2, Mail, Trash2, UserPlus } from "lucide-react";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/fields";
import { Input } from "@/components/ui/input";
import { passkeyErrorMessage } from "@/lib/client-api";
import { actionWithStepUp } from "@/lib/step-up";
import { changeRole, createInvite, removeMember, revokeInvite, updateHousehold } from "./actions";

type Role = "owner" | "member" | "viewer";

const ROLE_HELP: Record<Role, string> = {
  owner: "Everything, including members, bank connections and deleting accounts",
  member: "View and edit transactions, budgets, rules and goals",
  viewer: "Read-only",
};

interface Props {
  me: { userId: string; role: Role };
  household: { name: string; budgetMode: "flexible" | "zero_based" };
  members: { userId: string; name: string; email: string; role: Role; joined: string }[];
  invites: { id: string; email: string; role: Role; expiresAt: string }[];
}

export function HouseholdView({ me, household, members, invites }: Props) {
  const isOwner = me.role === "owner";
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) =>
    start(async () => {
      setError(null);
      try {
        const r = await actionWithStepUp(fn);
        if (!r.ok) setError(r.error ?? "Something went wrong.");
        else after?.();
      } catch (e) {
        setError(passkeyErrorMessage(e));
      }
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

      <HouseholdSettings
        household={household}
        disabled={!isOwner || pending}
        onSave={(v) => run(() => updateHousehold(v))}
      />

      <Card>
        <CardHeader>
          <h2 className="font-semibold">Members</h2>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {members.map((m) => (
              <li key={m.userId} className="flex flex-wrap items-center gap-3 py-3">
                <div className="flex size-9 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
                  {m.name
                    .split(/\s+/)
                    .map((p) => p[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">
                    {m.name}{" "}
                    {m.userId === me.userId && <span className="text-muted-foreground">(you)</span>}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{m.email}</div>
                </div>
                {isOwner && m.userId !== me.userId ? (
                  <>
                    <Select
                      aria-label={`Role for ${m.name}`}
                      value={m.role}
                      disabled={pending}
                      onChange={(e) => run(() => changeRole(m.userId, e.target.value))}
                      className="h-8 w-auto text-xs"
                    >
                      <option value="owner">Owner</option>
                      <option value="member">Member</option>
                      <option value="viewer">Viewer</option>
                    </Select>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${m.name}`}
                      disabled={pending}
                      onClick={() =>
                        window.confirm(
                          `Remove ${m.name}? Their account and passkeys are deleted and they're signed out immediately.`,
                        ) && run(() => removeMember(m.userId))
                      }
                    >
                      <Trash2 />
                    </Button>
                  </>
                ) : (
                  <Badge tone={m.role === "owner" ? "accent" : "neutral"}>{m.role}</Badge>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {isOwner && <Invites invites={invites} pending={pending} run={run} />}
    </div>
  );
}

function HouseholdSettings({
  household,
  disabled,
  onSave,
}: {
  household: Props["household"];
  disabled: boolean;
  onSave: (v: Props["household"]) => void;
}) {
  const [name, setName] = useState(household.name);
  const [mode, setMode] = useState(household.budgetMode);
  const dirty = name !== household.name || mode !== household.budgetMode;
  return (
    <Card>
      <CardHeader>
        <h2 className="font-semibold">Settings</h2>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Field label="Household name" htmlFor="h-name">
          <Input
            id="h-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            disabled={disabled}
          />
        </Field>
        <Field label="Budgeting style" htmlFor="h-mode">
          <Select
            id="h-mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as typeof mode)}
            disabled={disabled}
          >
            <option value="flexible">Flexible: budget the categories you care about</option>
            <option value="zero_based">Zero-based: give every dollar of income a job</option>
          </Select>
        </Field>
        <Button disabled={disabled || !dirty} onClick={() => onSave({ name, budgetMode: mode })}>
          Save
        </Button>
      </CardContent>
    </Card>
  );
}

function Invites({
  invites,
  pending,
  run,
}: {
  invites: Props["invites"];
  pending: boolean;
  run: (
    fn: () => Promise<{ ok: boolean; error?: string; data?: unknown }>,
    after?: () => void,
  ) => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  return (
    <Card>
      <CardHeader>
        <h2 className="font-semibold">Invite someone</h2>
        <p className="text-sm text-muted-foreground">
          You'll get a single-use link to share privately (it expires in 7 days). They create their
          own passkey; nobody shares passwords.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form
          className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            let result: { ok: boolean; error?: string; data?: { url: string } } | undefined;
            run(
              async () => {
                result = await createInvite(email, role);
                return result;
              },
              () => {
                setLink(result?.data?.url ?? null);
                setCopied(false);
                setEmail("");
              },
            );
          }}
        >
          <Field label="Email" htmlFor="inv-email">
            <Input
              id="inv-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="partner@example.com"
            />
          </Field>
          <Field label="Role" htmlFor="inv-role">
            <Select
              id="inv-role"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="w-auto"
            >
              <option value="member">Member</option>
              <option value="viewer">Viewer</option>
              <option value="owner">Owner</option>
            </Select>
          </Field>
          <Button type="submit" disabled={pending || !email}>
            {pending ? <Loader2 className="animate-spin" /> : <UserPlus />} Create invite link
          </Button>
        </form>
        <p className="-mt-2 text-xs text-muted-foreground">{ROLE_HELP[role]}.</p>

        {link && (
          <div className="flex items-center gap-2 rounded-lg border bg-muted/50 p-2">
            <code
              className="min-w-0 flex-1 truncate px-2 font-mono text-xs"
              data-testid="invite-link"
            >
              {link}
            </code>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                await navigator.clipboard.writeText(link);
                setCopied(true);
              }}
            >
              {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        )}

        {invites.length > 0 && (
          <ul className="divide-y border-t">
            {invites.map((i) => (
              <li key={i.id} className="flex items-center gap-3 py-2 text-sm">
                <Mail className="size-4 text-muted-foreground" />
                <span className="flex-1 truncate">{i.email}</span>
                <Badge>{i.role}</Badge>
                <span className="text-xs text-muted-foreground">
                  expires{" "}
                  {new Date(i.expiresAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => run(() => revokeInvite(i.id))}
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
