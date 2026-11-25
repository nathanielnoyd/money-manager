"use client";

import type {
  getRewardsSummary,
  getWallet,
  listRewardCategories,
  listRewardPrograms,
} from "@mm/services";
import { Link2, Unlink } from "lucide-react";
import { useState, useTransition } from "react";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox, Select } from "@/components/ui/fields";
import { Input } from "@/components/ui/input";
import { saveRewardCategory, saveRewardValuation, saveWalletCard } from "./actions";
import { cents } from "./format";

export type Out<T extends { run: (...a: never[]) => unknown }> = Awaited<ReturnType<T["run"]>>;
export type Wallet = Out<typeof getWallet>;
export type Summary = Out<typeof getRewardsSummary>;
export type Categories = Out<typeof listRewardCategories>;
export type Programs = Out<typeof listRewardPrograms>;
export interface CatalogOption {
  slug: string;
  label: string;
  issuer: string;
  rates: string;
  rotating: boolean;
}

export type Run = (fn: () => Promise<{ ok: boolean; error?: string }>) => void;

/** Run a server action in a transition and keep its error message for an alert banner. */
export function useRun(canEdit: boolean) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run: Run = (fn) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) setError(r.error ?? "Something went wrong.");
    });
  const banner = error ? (
    <div
      role="alert"
      className="rounded-xl border border-negative/30 bg-negative/10 p-3 text-sm text-negative"
    >
      {error}
    </div>
  ) : null;
  return { run, disabled: !canEdit || pending, pending, banner };
}

export function Totals({ ytd, month }: { ytd: Summary; month: Summary }) {
  const tiles = [
    { label: "This month", value: month.value, sub: `${month.transactions} purchases` },
    {
      label: "Year to date",
      value: ytd.value,
      sub: `on ${ytd.spend.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })} spend`,
    },
    {
      label: "Best card every time",
      value: ytd.bestPossibleValue,
      sub:
        ytd.missedValue > 0
          ? `${ytd.missedValue.toLocaleString("en-US", { style: "currency", currency: "USD" })} more this year`
          : "You're already using the best cards",
    },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {tiles.map((t) => (
        <Card key={t.label}>
          <CardContent className="pt-5">
            <div className="text-sm text-muted-foreground">{t.label}</div>
            <Money value={cents(t.value)} className="text-2xl font-semibold" />
            <div className="text-xs text-muted-foreground">{t.sub}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function WalletRow({
  card,
  catalog,
  disabled,
  run,
  children,
}: {
  card: Wallet["cards"][number];
  catalog: CatalogOption[];
  disabled: boolean;
  run: Run;
  children?: React.ReactNode;
}) {
  const r = card.rotating;
  return (
    <li className="flex flex-col gap-2 py-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-medium">{card.name}</div>
          <div className="text-xs text-muted-foreground">
            {card.account} · {card.program}
            {card.annualFee ? ` · $${card.annualFee} annual fee` : " · no annual fee"}
          </div>
          <div className="mt-1 text-sm text-muted-foreground">{card.rates}</div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Unlink ${card.account}`}
          disabled={disabled}
          onClick={() => run(() => saveWalletCard({ accountId: card.accountId, cardSlug: null }))}
        >
          <Unlink />
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <CardSelect
          label={`Card for ${card.account}`}
          value={card.slug ?? ""}
          catalog={catalog}
          disabled={disabled}
          onChange={(slug) =>
            run(() => saveWalletCard({ accountId: card.accountId, cardSlug: slug }))
          }
        />
        <label className="flex items-center gap-2 text-muted-foreground">
          Opened
          <Input
            type="date"
            aria-label={`Opened date for ${card.account}`}
            className="h-8 w-40"
            defaultValue={card.openedOn ?? ""}
            disabled={disabled}
            onBlur={(e) =>
              e.target.value !== (card.openedOn ?? "") &&
              run(() =>
                saveWalletCard({
                  accountId: card.accountId,
                  cardSlug: card.slug ?? null,
                  openedOn: e.target.value || null,
                }),
              )
            }
          />
        </label>
        {r && (
          <label className="flex items-center gap-2">
            <Checkbox
              checked={r.activated}
              disabled={disabled || r.categories.length === 0}
              aria-label={`Activated ${r.quarter} categories for ${card.account}`}
              onChange={(e) =>
                run(() =>
                  saveWalletCard({
                    accountId: card.accountId,
                    cardSlug: card.slug ?? null,
                    activations: e.target.checked
                      ? [...r.activations, r.quarter]
                      : r.activations.filter((q) => q !== r.quarter),
                  }),
                )
              }
            />
            <span>
              Activated {r.quarter}
              {r.categories.length
                ? ` (${r.categories.join(", ").replaceAll("_", " ")})`
                : " (not announced yet)"}
            </span>
          </label>
        )}
        {card.choice && (
          <label className="flex items-center gap-2 text-muted-foreground">
            Bonus category
            <Select
              aria-label={`Bonus category for ${card.account}`}
              value={card.choice.chosen[0] ?? ""}
              disabled={disabled}
              className="h-8 w-auto text-sm"
              onChange={(e) =>
                run(() =>
                  saveWalletCard({
                    accountId: card.accountId,
                    cardSlug: card.slug ?? null,
                    choices: e.target.value ? [e.target.value as never] : [],
                  }),
                )
              }
            >
              <option value="">Not chosen</option>
              {card.choice.eligible.map((c) => (
                <option key={c} value={c}>
                  {c.replaceAll("_", " ")}
                </option>
              ))}
            </Select>
          </label>
        )}
      </div>
      {children}
    </li>
  );
}

export function UnlinkedRow({
  account,
  catalog,
  disabled,
  run,
}: {
  account: Wallet["unlinkedCreditAccounts"][number];
  catalog: CatalogOption[];
  disabled: boolean;
  run: Run;
}) {
  const [slug, setSlug] = useState(account.suggestions[0] ?? "");
  return (
    <li className="flex flex-wrap items-center gap-3 py-4">
      <div className="min-w-0 flex-1">
        <div className="font-medium">{account.account}</div>
        <div className="text-xs text-muted-foreground">
          {account.suggestions.length ? "Is this the card?" : "Which card is this?"}
        </div>
      </div>
      <CardSelect
        label={`Card for ${account.account}`}
        value={slug}
        catalog={catalog}
        suggested={account.suggestions}
        disabled={disabled}
        onChange={setSlug}
      />
      <Button
        size="sm"
        aria-label={`Link card to ${account.account}`}
        disabled={disabled || !slug}
        onClick={() => run(() => saveWalletCard({ accountId: account.accountId, cardSlug: slug }))}
      >
        <Link2 /> Link card
      </Button>
    </li>
  );
}

export function CardSelect({
  label,
  value,
  catalog,
  suggested = [],
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  catalog: CatalogOption[];
  suggested?: string[];
  disabled: boolean;
  onChange: (slug: string) => void;
}) {
  const bySlug = new Map(catalog.map((c) => [c.slug, c]));
  return (
    <Select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 w-auto max-w-72 text-sm"
    >
      <option value="">Choose a card…</option>
      {suggested.length > 0 && (
        <optgroup label="Suggested">
          {suggested.map((s) => (
            <option key={`s-${s}`} value={s}>
              {bySlug.get(s)?.label ?? s}
            </option>
          ))}
        </optgroup>
      )}
      <optgroup label="All cards">
        {catalog.map((c) => (
          <option key={c.slug} value={c.slug}>
            {c.label}
          </option>
        ))}
      </optgroup>
    </Select>
  );
}

export function Breakdown({ ytd }: { ytd: Summary }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <h2 className="font-semibold">By card, this year</h2>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <tbody className="divide-y">
              {ytd.byCard.map((c) => (
                <tr key={c.walletCardId}>
                  <td className="py-2">
                    <div>{c.card}</div>
                    <div className="text-xs text-muted-foreground">
                      {c.points.toLocaleString()} points on $
                      {c.spend.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                    </div>
                  </td>
                  <td className="py-2 text-right">
                    <Money value={cents(c.value)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <h2 className="font-semibold">By category, this year</h2>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <tbody className="divide-y">
              {ytd.byCategory.slice(0, 10).map((c) => (
                <tr key={c.category}>
                  <td className="py-2">
                    <div>{c.label}</div>
                    <div className="text-xs text-muted-foreground">
                      ${c.spend.toLocaleString("en-US", { maximumFractionDigits: 0 })} spent
                    </div>
                  </td>
                  <td className="py-2 text-right">
                    <Money value={cents(c.value)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

export function CategoryMap({
  categories,
  disabled,
  run,
}: {
  categories: Categories;
  disabled: boolean;
  run: Run;
}) {
  return (
    <Card>
      <CardHeader>
        <h2 className="font-semibold">How your categories earn</h2>
        <p className="text-sm text-muted-foreground">
          Card rates are defined for reward categories like dining or groceries. Choose which one
          each of your spending categories counts as.
        </p>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {categories.budgetCategories.map((c) => (
            <li key={c.categoryId} className="flex items-center gap-3 text-sm">
              <span className="min-w-0 flex-1 truncate">{c.category}</span>
              {c.source === "household" && <Badge tone="accent">custom</Badge>}
              <Select
                aria-label={`Reward category for ${c.category}`}
                value={c.rewardCategory}
                disabled={disabled}
                className="h-8 w-44 text-sm"
                onChange={(e) =>
                  run(() =>
                    saveRewardCategory({
                      categoryId: c.categoryId,
                      rewardCategory: e.target.value as never,
                    }),
                  )
                }
              >
                {categories.rewardCategories.map((r) => (
                  <option key={r.id} value={r.id} title={r.description}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function PointValues({
  programs,
  disabled,
  run,
}: {
  programs: Programs;
  disabled: boolean;
  run: Run;
}) {
  return (
    <Card>
      <CardHeader>
        <h2 className="font-semibold">Point values</h2>
        <p className="text-sm text-muted-foreground">
          How many cents each point is worth. "Typical" uses a published monthly valuation; "Floor"
          uses what you can always get, such as cash back or a fixed travel rate.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <label className="flex items-center gap-3 text-sm">
          Value points at
          <Select
            aria-label="Point valuation"
            value={programs.valuation}
            disabled={disabled}
            className="h-8 w-auto"
            onChange={(e) =>
              run(() => saveRewardValuation({ valuation: e.target.value as "typical" | "floor" }))
            }
          >
            <option value="typical">Typical value</option>
            <option value="floor">Floor value</option>
          </Select>
        </label>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1 font-normal">Program</th>
              <th className="py-1 text-right font-normal">Floor</th>
              <th className="py-1 text-right font-normal">Typical</th>
              <th className="py-1 text-right font-normal">Using (¢)</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {programs.programs
              .filter((p) => p.slug !== "cash_back")
              .map((p) => (
                <tr key={p.slug}>
                  <td className="py-2" title={p.valuationSource}>
                    {p.name}
                  </td>
                  <td className="py-2 text-right tabular">{p.floorCpp}¢</td>
                  <td className="py-2 text-right tabular">
                    {p.typicalCpp}¢
                    {p.edited && (
                      <div className="text-xs text-muted-foreground">
                        default {p.defaultTypicalCpp}¢
                      </div>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    <Input
                      key={`${p.slug}-${p.usingCpp}`}
                      type="number"
                      step="0.05"
                      min="0"
                      max="10"
                      aria-label={`Cents per point for ${p.name}`}
                      className="ml-auto h-8 w-20 text-right"
                      defaultValue={p.usingCpp}
                      disabled={disabled}
                      onBlur={(e) => {
                        const v = e.target.value === "" ? null : Number(e.target.value);
                        if (v === p.usingCpp) return;
                        run(() => saveRewardValuation({ cpp: { [p.slug]: v } }));
                      }}
                    />
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        <p className="text-xs text-muted-foreground">
          Typical values: {programs.programs[0]?.valuationSource}. Clear a box to go back to the
          default.
        </p>
      </CardContent>
    </Card>
  );
}
