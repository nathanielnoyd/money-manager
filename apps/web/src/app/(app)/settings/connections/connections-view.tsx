"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Landmark,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Unplug,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/fields";
import { passkeyErrorMessage } from "@/lib/client-api";
import { actionWithStepUp } from "@/lib/step-up";
import { addSimpleFin, disconnect, syncNow } from "./actions";
import { PlaidButton } from "./plaid-button";
import { TellerButton } from "./teller-button";

interface Conn {
  id: string;
  provider: string;
  institutionName: string;
  status: "linking" | "active" | "needs_reauth" | "error" | "disconnected";
  lastSyncedAt: string | null;
  nextSyncAt: string | null;
  lastError: string | null;
  accounts: number;
  syncing: boolean;
}

export function ConnectionsView({
  connections,
  plaidEnabled,
  teller,
}: {
  connections: Conn[];
  plaidEnabled: boolean;
  teller: { applicationId: string; env: string } | null;
}) {
  const router = useRouter();
  const busy = connections.some(
    (c) =>
      c.status === "linking" ||
      c.syncing ||
      (c.nextSyncAt && new Date(c.nextSyncAt) <= new Date() && c.status === "active"),
  );

  // While something is linking/syncing, refresh every few seconds.
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [busy, router]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-end gap-2">
        {teller && <TellerButton applicationId={teller.applicationId} environment={teller.env} />}
        {plaidEnabled && <PlaidButton />}
        <AddSimpleFin />
      </div>
      {connections.length === 0 ? (
        <EmptyState icon={Landmark} title="No connections yet">
          Link your banks through SimpleFIN Bridge (about $15/year, paid to them directly), or
          import CSV/OFX files from the Transactions page.
        </EmptyState>
      ) : (
        <Card className="divide-y">
          {connections.map((c) => (
            <ConnectionRow key={c.id} c={c} />
          ))}
        </Card>
      )}
    </div>
  );
}

function ConnectionRow({ c }: { c: Conn }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      setError(null);
      try {
        const r = await actionWithStepUp(fn);
        if (!r.ok) setError(r.error ?? "Something went wrong.");
      } catch (e) {
        setError(passkeyErrorMessage(e));
      }
    });

  return (
    <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
        <Link2 className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 font-medium">
          {c.institutionName}
          <StatusBadge c={c} />
        </div>
        <div className="text-sm text-muted-foreground">
          {c.accounts} account{c.accounts === 1 ? "" : "s"}
          {c.lastSyncedAt &&
            ` · synced ${new Date(c.lastSyncedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`}
        </div>
        {c.lastError && (
          <p
            className={`mt-1 text-sm ${c.status === "active" ? "text-muted-foreground" : "text-negative"}`}
          >
            {c.lastError}
          </p>
        )}
        {error && <p className="mt-1 text-sm text-negative">{error}</p>}
      </div>
      {c.status !== "disconnected" && (
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={pending || c.status === "linking"}
            onClick={() => run(() => syncNow(c.id))}
          >
            {pending || c.syncing ? <Loader2 className="animate-spin" /> : <RefreshCw />} Sync now
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() =>
              window.confirm(
                `Disconnect ${c.institutionName}? Syncing stops and the stored credential is destroyed. Your accounts and history stay.`,
              ) && run(() => disconnect(c.id))
            }
          >
            <Unplug /> Disconnect
          </Button>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ c }: { c: Conn }) {
  if (c.status === "linking")
    return (
      <Badge tone="accent">
        <Loader2 className="mr-1 size-3 animate-spin" />
        Linking…
      </Badge>
    );
  if (c.syncing)
    return (
      <Badge tone="accent">
        <Loader2 className="mr-1 size-3 animate-spin" />
        Syncing…
      </Badge>
    );
  if (c.status === "active")
    return (
      <Badge tone="accent">
        <CheckCircle2 className="mr-1 size-3" />
        Connected
      </Badge>
    );
  if (c.status === "needs_reauth")
    return (
      <Badge tone="warning">
        <AlertTriangle className="mr-1 size-3" />
        Reconnect needed
      </Badge>
    );
  if (c.status === "error")
    return (
      <Badge tone="warning">
        <AlertTriangle className="mr-1 size-3" />
        Error
      </Badge>
    );
  return <Badge>Disconnected</Badge>;
}

function AddSimpleFin() {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> Connect with SimpleFIN
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Connect with SimpleFIN"
        description="Read-only access to your banks, cards and brokerages."
      >
        <ol className="mb-4 list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
          <li>
            Create an account at{" "}
            <a
              href="https://beta-bridge.simplefin.org"
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-0.5 text-primary hover:underline"
            >
              SimpleFIN Bridge <ExternalLink className="size-3" />
            </a>{" "}
            and connect your institutions there.
          </li>
          <li>
            Choose <strong>New SimpleFIN Connection</strong> and copy the setup token.
          </li>
          <li>Paste it below. It works once; this server exchanges it for read-only access.</li>
        </ol>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              setError(null);
              try {
                const r = await actionWithStepUp(() => addSimpleFin(token));
                if (r.ok) {
                  setOpen(false);
                  setToken("");
                } else setError(r.error ?? "Something went wrong.");
              } catch (err) {
                setError(passkeyErrorMessage(err));
              }
            });
          }}
          className="flex flex-col gap-4"
        >
          <Field label="Setup token" htmlFor="sf-token">
            <Textarea
              id="sf-token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
              rows={4}
              className="font-mono text-xs"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          {error && (
            <p role="alert" className="text-sm text-negative">
              {error}
            </p>
          )}
          <Button type="submit" disabled={pending || token.trim().length < 20}>
            {pending && <Loader2 className="animate-spin" />} Connect
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
