"use client";

import type { recommendCards, simulateCard } from "@mm/services";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/fields";
import { simulate } from "../actions";
import type { CatalogOption, Out } from "../components";
import { cents } from "../format";

type Recs = Out<typeof recommendCards>;
type Sim = Out<typeof simulateCard>;

const whole = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function ExploreView({
  recs,
  business,
  catalog,
}: {
  recs: Recs;
  business: boolean;
  catalog: CatalogOption[];
}) {
  const [pending, start] = useTransition();
  const [sim, setSim] = useState<Sim | null>(null);
  const [error, setError] = useState<string | null>(null);
  const based =
    recs.basedOnDays < 365
      ? `your last ${recs.basedOnDays} days of card spending, scaled to a year,`
      : "your last 12 months of card spending";
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <h2 className="font-semibold">Cards that would pay off</h2>
          <p className="text-sm text-muted-foreground">
            Each card is added to your wallet and {based} is replayed, with every purchase on the
            best card. Shown net of the annual fee. Sign-up bonuses, statement credits and approval
            odds aren't included. This is arithmetic on your data, not advice.
          </p>
          <Link
            href={business ? "/rewards/explore" : "/rewards/explore?business=1"}
            className="text-sm text-primary hover:underline"
          >
            {business ? "Hide business cards" : "Include business cards"}
          </Link>
        </CardHeader>
        <CardContent>
          {recs.cards.length === 0 ? (
            <p className="text-sm text-muted-foreground">No card spending to replay yet.</p>
          ) : (
            <ul className="divide-y">
              {recs.cards.map((c) => (
                <li key={c.slug} className="flex flex-wrap items-start gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">
                      {c.card} {c.business && <Badge>business</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {c.program} ·{" "}
                      {c.annualFee ? `${whole(c.annualFee)} annual fee` : "no annual fee"}
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">{c.rates}</div>
                  </div>
                  <div className="text-right">
                    <Money
                      value={cents(c.netPerYear)}
                      signed
                      colored
                      className="text-lg font-semibold"
                    />
                    <div className="text-xs text-muted-foreground">
                      per year ({whole(c.extraRewardsPerYear)} more rewards)
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="font-semibold">Try any card</h2>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <Select
            aria-label="Card to simulate"
            defaultValue=""
            className="h-9 w-full max-w-md"
            disabled={pending}
            onChange={(e) => {
              const slug = e.target.value;
              if (!slug) return;
              start(async () => {
                setError(null);
                const r = await simulate(slug);
                if (r.ok && r.data) setSim(r.data);
                else setError(r.ok ? "No result." : r.error);
              });
            }}
          >
            <option value="">Choose a card…</option>
            {catalog.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.label}
              </option>
            ))}
          </Select>
          {error && <p className="text-negative">{error}</p>}
          {sim && (
            <div data-testid="simulation" className="flex flex-col gap-2">
              <div>
                <span className="font-medium">{sim.card}</span> would add{" "}
                <Money value={cents(sim.extraRewardsPerYear)} /> a year in rewards.{" "}
                {sim.annualFee
                  ? `After its ${whole(sim.annualFee)} fee, that's `
                  : "With no annual fee, that's "}
                <Money value={cents(sim.netPerYear)} signed colored className="font-semibold" />.
              </div>
              {sim.categoriesItWouldWin.length > 0 && (
                <ul className="list-disc pl-5 text-muted-foreground">
                  {sim.categoriesItWouldWin.slice(0, 6).map((w) => (
                    <li key={w.category}>
                      {w.label}: {whole(w.extraPerYear)} more a year
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
