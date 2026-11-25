"use client";

import type { listCatalogChanges } from "@mm/services";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/fields";
import { resetCatalog, reviewCatalog, saveCatalogApproval, undoCatalogChange } from "../actions";
import type { Out, Run } from "../components";

type Change = Out<typeof listCatalogChanges>["changes"][number];

export interface EditedEntry {
  entity: "card" | "program";
  slug: string;
  name: string;
  custom: boolean;
}

const WHO: Record<Change["via"], string> = {
  session: "",
  token: "Agent",
  worker: "Built-in refresher",
};

const FIELD: Record<string, string> = {
  annualFee: "annual fee",
  fxFeePercent: "foreign transaction fee",
  base: "base rate",
  earn: "earn rates",
  rotating: "rotating categories",
  typicalCpp: "typical value",
  floorCpp: "floor value",
  floorNote: "floor note",
  valuation: "valuation source",
  verifiedAt: "checked date",
  sources: "sources",
  name: "name",
  issuer: "issuer",
  network: "network",
  program: "program",
  business: "business card",
  aliases: "aliases",
  notes: "notes",
};

function describe(c: Change): string {
  if (c.action === "reset") return "Reset to the default";
  if (c.action === "revert") return "Undid an earlier change";
  if (c.action === "add") return "Added as a custom card";
  return c.fields.length
    ? `Changed ${c.fields.map((f) => FIELD[f] ?? f).join(", ")}`
    : "Checked, no changes";
}

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

function ChangeRow({ c, actions }: { c: Change; actions?: React.ReactNode }) {
  const who = c.via === "session" ? (c.by ?? "Someone") : WHO[c.via];
  return (
    <li className="flex flex-wrap items-start gap-3 py-3 text-sm" data-testid="catalog-change">
      <div className="min-w-0 flex-1">
        <div className="font-medium">
          {c.name}{" "}
          {c.status !== "applied" && (
            <Badge>{c.status === "pending" ? "waiting for approval" : c.status}</Badge>
          )}
        </div>
        <div className="text-muted-foreground">
          {describe(c)}
          {c.note ? `: ${c.note}` : ""}
        </div>
        <div className="text-xs text-muted-foreground">
          {who} · {new Date(c.at).toLocaleDateString("en-US", { dateStyle: "medium" })}
          {c.sourceUrl && (
            <>
              {" · "}
              <a
                href={c.sourceUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="text-primary hover:underline"
              >
                {host(c.sourceUrl)}
              </a>
            </>
          )}
        </div>
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </li>
  );
}

export function CatalogSection({
  changes,
  pending,
  edited,
  requireApproval,
  isOwner,
  disabled,
  run,
}: {
  changes: Change[];
  pending: Change[];
  edited: EditedEntry[];
  requireApproval: boolean;
  isOwner: boolean;
  disabled: boolean;
  run: Run;
}) {
  // Show the choice right away; the server value wins once the page refreshes.
  const [approval, setApproval] = useState(requireApproval);
  useEffect(() => setApproval(requireApproval), [requireApproval]);
  return (
    <Card>
      <CardHeader>
        <h2 className="font-semibold">Card catalog</h2>
        <p className="text-sm text-muted-foreground">
          Rates, fees and point values come with the app and are checked against issuers' pages.
          You, your agent or the built-in refresher (Settings → AI) can correct them for this
          household. Every change keeps its source and can be undone.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            className="mt-0.5"
            checked={approval}
            disabled={disabled || !isOwner}
            onChange={(e) => {
              const required = e.target.checked;
              setApproval(required);
              run(() => saveCatalogApproval({ required }));
            }}
          />
          <span>
            Require my approval for changes made by agents and the refresher
            {!isOwner && (
              <span className="block text-xs text-muted-foreground">
                Only the household owner can change this.
              </span>
            )}
          </span>
        </label>

        {pending.length > 0 && (
          <section>
            <h3 className="text-sm font-medium">Waiting for approval</h3>
            <ul className="divide-y">
              {pending.map((c) => (
                <ChangeRow
                  key={c.changeId}
                  c={c}
                  actions={
                    <>
                      <Button
                        size="sm"
                        disabled={disabled}
                        onClick={() =>
                          run(() => reviewCatalog({ changeId: c.changeId, decision: "approve" }))
                        }
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={disabled}
                        onClick={() =>
                          run(() => reviewCatalog({ changeId: c.changeId, decision: "reject" }))
                        }
                      >
                        Reject
                      </Button>
                    </>
                  }
                />
              ))}
            </ul>
          </section>
        )}

        {edited.length > 0 && (
          <section>
            <h3 className="text-sm font-medium">Edited for this household</h3>
            <ul className="divide-y">
              {edited.map((e) => (
                <li key={`${e.entity}:${e.slug}`} className="flex items-center gap-3 py-2 text-sm">
                  <span className="flex-1">
                    {e.name} {e.custom && <Badge>custom</Badge>}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={disabled}
                    aria-label={`${e.custom ? "Remove" : "Reset"} ${e.name}`}
                    onClick={() => run(() => resetCatalog({ entity: e.entity, slug: e.slug }))}
                  >
                    {e.custom ? "Remove" : "Reset to default"}
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h3 className="text-sm font-medium">History</h3>
          {changes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No changes yet. Ask your agent to run the "Refresh the card catalog" prompt, or turn
              on the built-in refresher under Settings → AI.
            </p>
          ) : (
            <ul className="divide-y">
              {changes.map((c, i) => (
                <ChangeRow
                  key={c.changeId}
                  c={c}
                  actions={
                    c.status === "applied" &&
                    changes.findIndex(
                      (x) => x.slug === c.slug && x.entity === c.entity && x.status === "applied",
                    ) === i ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={disabled}
                        aria-label={`Undo change to ${c.name}`}
                        onClick={() => run(() => undoCatalogChange({ changeId: c.changeId }))}
                      >
                        Undo
                      </Button>
                    ) : undefined
                  }
                />
              ))}
            </ul>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
