"use client";

import { Loader2, ShieldCheck } from "lucide-react";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/fields";
import { Input } from "@/components/ui/input";
import { actionWithStepUp } from "@/lib/step-up";
import { saveAiSettings } from "./actions";

interface Props {
  configured: boolean;
  model: string | null;
  settings: {
    enabled: boolean;
    categorize: boolean;
    digest: boolean;
    catalogRefresh: boolean;
    consentedAt: string | null;
  };
  usage: { feature: string; calls: number; input: number; output: number }[];
  /** Tokens used this calendar month, and the household's monthly limit. */
  budget: { used: number; budget: number };
  canEdit: boolean;
}

const FEATURE: Record<string, string> = {
  ask: "Ask",
  categorize: "Categorization",
  digest: "Weekly digest",
  catalog_refresh: "Card catalog refresh",
};

export function AiSettingsForm({ configured, model, settings, usage, budget, canEdit }: Props) {
  const [enabled, setEnabled] = useState(settings.enabled);
  const [categorize, setCategorize] = useState(settings.categorize);
  const [digest, setDigest] = useState(settings.digest);
  const [catalogRefresh, setCatalogRefresh] = useState(settings.catalogRefresh);
  const [consent, setConsent] = useState(!!settings.consentedAt);
  const [limit, setLimit] = useState(String(budget.budget));
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const disabled = !canEdit || !configured || pending;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <h2 className="font-semibold">Server</h2>
          {configured ? (
            <Badge tone="accent">Configured · {model}</Badge>
          ) : (
            <Badge tone="warning">No API key</Badge>
          )}
        </CardHeader>
        {!configured && (
          <CardContent className="text-sm text-muted-foreground">
            Set <code className="rounded bg-muted px-1 font-mono text-xs">ANTHROPIC_API_KEY</code>{" "}
            in the server's <code className="rounded bg-muted px-1 font-mono text-xs">.env</code>{" "}
            and restart. Optionally set{" "}
            <code className="rounded bg-muted px-1 font-mono text-xs">AI_MODEL</code> to choose the
            model.
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <h2 className="flex items-center gap-2 font-semibold">
            <ShieldCheck className="size-4 text-primary" /> What gets shared with Anthropic
          </h2>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <ul className="list-disc space-y-1.5 pl-5 text-muted-foreground">
            <li>
              <strong className="text-foreground">Ask:</strong> your question, plus only the results
              of the lookups Claude makes: category and merchant totals, monthly totals, budget
              figures, account names and balances, and at most 25 matching transactions at a time
              (date, merchant, amount, category, account name, notes).
            </li>
            <li>
              <strong className="text-foreground">Categorization:</strong> each uncategorized
              transaction's bank description and amount, plus up to 40 of your own past "description
              → category" choices as examples.
            </li>
            <li>
              <strong className="text-foreground">Weekly digest:</strong> the week's totals, top
              categories, three largest charges, unusual items, upcoming bills and budget totals.
            </li>
            <li>
              <strong className="text-foreground">Card catalog refresh:</strong> the public catalog
              entry for each card in your wallet (its rates, fees and source links) and the points
              programs they earn. No transactions, balances or account names. Claude reads only the
              issuers' and valuation publishers' own sites.
            </li>
            <li>
              <strong className="text-foreground">Never sent:</strong> account numbers, bank
              credentials or tokens, passkeys, your full transaction history, or other households'
              data.
            </li>
          </ul>
          <p className="text-muted-foreground">
            Requests use this server's API key and are covered by Anthropic's commercial terms and
            privacy policy. Questions aren't stored here; only token counts are logged below.
          </p>
          <label className="flex items-start gap-2">
            <Checkbox
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              disabled={disabled || !!settings.consentedAt}
              className="mt-0.5"
            />
            <span>
              I understand what's shared and want to use AI features for this household.
              {settings.consentedAt && (
                <span className="block text-xs text-muted-foreground">
                  Accepted {new Date(settings.consentedAt).toLocaleDateString("en-US")}
                </span>
              )}
            </span>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="font-semibold">Features</h2>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <label className="flex items-start gap-2">
            <Checkbox
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              disabled={disabled}
              className="mt-0.5"
            />
            <span>
              Enable AI features
              <span className="block text-xs text-muted-foreground">
                Turns on the Ask page and the "Categorize with AI" button.
              </span>
            </span>
          </label>
          <label className="ml-6 flex items-start gap-2">
            <Checkbox
              checked={categorize}
              onChange={(e) => setCategorize(e.target.checked)}
              disabled={disabled || !enabled}
              className="mt-0.5"
            />
            <span>
              Categorize new transactions automatically after each sync
              <span className="block text-xs text-muted-foreground">
                Only fills empty categories, never overrides yours; AI choices stay marked "needs
                review".
              </span>
            </span>
          </label>
          <label className="ml-6 flex items-start gap-2">
            <Checkbox
              checked={digest}
              onChange={(e) => setDigest(e.target.checked)}
              disabled={disabled || !enabled}
              className="mt-0.5"
            />
            <span>
              Weekly digest on Monday mornings
              <span className="block text-xs text-muted-foreground">
                Shown on the dashboard, and pushed through ntfy if notifications are set up.
              </span>
            </span>
          </label>
          <label className="ml-6 flex items-start gap-2">
            <Checkbox
              checked={catalogRefresh}
              onChange={(e) => setCatalogRefresh(e.target.checked)}
              disabled={disabled || !enabled}
              className="mt-0.5"
            />
            <span>
              Keep my cards' rates and fees up to date
              <span className="block text-xs text-muted-foreground">
                Once a month, checks the cards in your wallet against the issuers' pages and records
                what changed with its source. Review or undo changes in Rewards → Settings.
              </span>
            </span>
          </label>
          <label className="flex flex-col gap-1">
            <span>Monthly token limit</span>
            <Input
              type="number"
              inputMode="numeric"
              min={50_000}
              step={50_000}
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              disabled={disabled || !enabled}
              className="max-w-48"
            />
            <span className="text-xs text-muted-foreground">
              Every AI feature stops for the rest of the month once this many tokens (input plus
              output) have been used. Used so far this month: {budget.used.toLocaleString()}.
            </span>
          </label>
          {status && (
            <p role="status" className={status.ok ? "text-muted-foreground" : "text-negative"}>
              {status.text}
            </p>
          )}
          {canEdit && (
            <div>
              <Button
                disabled={disabled}
                onClick={() =>
                  start(async () => {
                    const r = await actionWithStepUp(() =>
                      saveAiSettings({
                        enabled,
                        categorize,
                        digest,
                        catalogRefresh,
                        consent,
                        monthlyTokenBudget: Number(limit),
                      }),
                    );
                    setStatus(r.ok ? { ok: true, text: "Saved." } : { ok: false, text: r.error });
                  })
                }
              >
                {pending && <Loader2 className="animate-spin" />} Save
              </Button>
            </div>
          )}
          {!canEdit && (
            <p className="text-muted-foreground">Only the household owner can change these.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="font-semibold">Usage · last 30 days</h2>
        </CardHeader>
        <CardContent>
          {usage.length === 0 ? (
            <p className="text-sm text-muted-foreground">No AI calls yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 font-medium">Feature</th>
                  <th className="py-1 text-right font-medium">Calls</th>
                  <th className="py-1 text-right font-medium">Input tokens</th>
                  <th className="py-1 text-right font-medium">Output tokens</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {usage.map((u) => (
                  <tr key={u.feature}>
                    <td className="py-1.5">{FEATURE[u.feature] ?? u.feature}</td>
                    <td className="py-1.5 text-right tabular">{u.calls}</td>
                    <td className="py-1.5 text-right tabular">{u.input.toLocaleString()}</td>
                    <td className="py-1.5 text-right tabular">{u.output.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
