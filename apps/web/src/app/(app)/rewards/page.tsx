import { addDays, todayIso } from "@mm/core";
import {
  execute,
  getCheatSheet,
  getMissedValue,
  getRewardsSummary,
  getSignupBonusProgress,
} from "@mm/services";
import Link from "next/link";
import { Money } from "@/components/money";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { db } from "@/lib/db";
import { Breakdown, Totals } from "./components";
import { rewardsContext } from "./data";
import { cents } from "./format";
import { NoCards } from "./no-cards";

export const metadata = { title: "Rewards" };

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export default async function RewardsOverview() {
  const { p, wallet, hasCredit } = await rewardsContext();
  if (!hasCredit) return <NoCards />;
  if (!wallet.cards.length)
    return (
      <Card>
        <CardContent className="pt-5 text-sm">
          Link your credit cards on the{" "}
          <Link href="/rewards/wallet" className="text-primary hover:underline">
            Wallet
          </Link>{" "}
          tab to see what they earn.
        </CardContent>
      </Card>
    );
  const today = todayIso();
  const [ytd, month, sheet, missed, bonuses] = await Promise.all([
    execute(db(), p, getRewardsSummary, { start: `${today.slice(0, 4)}-01-01`, end: today }),
    execute(db(), p, getRewardsSummary, { start: `${today.slice(0, 7)}-01`, end: today }),
    execute(db(), p, getCheatSheet, {}),
    execute(db(), p, getMissedValue, { start: addDays(today, -89), end: today }),
    execute(db(), p, getSignupBonusProgress, {}),
  ]);
  // Only categories where the wallet beats a plain 1x/1% are worth a line on the cheat sheet.
  const highlights = sheet.categories.filter(
    (c) =>
      c.category === "everything_else" ||
      c.valuePer100 >
        (sheet.categories.find((x) => x.category === "everything_else")?.valuePer100 ?? 0),
  );

  return (
    <div className="flex flex-col gap-4">
      <Totals ytd={ytd} month={month} />

      {bonuses.bonuses.length > 0 && (
        <Card>
          <CardHeader>
            <h2 className="font-semibold">Sign-up bonuses</h2>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {bonuses.bonuses.map((b) => {
              const pct = Math.min(100, Math.round((b.spent / b.minSpend) * 100));
              return (
                <div key={b.walletCardId} className="flex flex-col gap-1.5 text-sm">
                  <div className="flex flex-wrap justify-between gap-2">
                    <span className="font-medium">
                      {b.card}: {b.points.toLocaleString()} points
                    </span>
                    <span className="text-muted-foreground">
                      {b.status === "met"
                        ? "Spend reached"
                        : b.status === "missed"
                          ? `Deadline passed ${b.deadline}`
                          : `${usd(b.remaining)} to go · ${b.daysLeft} days left${b.neededPerDay ? ` · ${usd(b.neededPerDay)}/day` : ""}`}
                    </span>
                  </div>
                  <div
                    role="progressbar"
                    aria-label={`${b.card} sign-up bonus progress`}
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    className="h-2 overflow-hidden rounded-full bg-muted"
                  >
                    <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <h2 className="font-semibold">Which card to use</h2>
            <p className="text-sm text-muted-foreground">Value per $100 at your point values.</p>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <tbody className="divide-y">
                {highlights.map((c) => (
                  <tr key={c.category}>
                    <td className="py-2">{c.label}</td>
                    <td className="py-2">
                      <div>{c.card}</div>
                      {c.runnerUp && (
                        <div className="text-xs text-muted-foreground">
                          then {c.runnerUp} ({usd(c.runnerUpValuePer100 ?? 0)})
                        </div>
                      )}
                    </td>
                    <td className="py-2 text-right tabular">
                      {c.rate} · <Money value={cents(c.valuePer100)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="font-semibold">Left on the table</h2>
            <p className="text-sm text-muted-foreground">
              Last 90 days: {usd(missed.earned)} earned, {usd(missed.bestPossible)} possible with
              your best card each time.
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            {missed.missed <= 0 ? (
              <p>You used your best card for every purchase. Nice.</p>
            ) : (
              <>
                <ul className="list-disc pl-5">
                  {missed.suggestions.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
                <table className="w-full">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="py-1 font-normal">Biggest misses</th>
                      <th className="py-1 text-right font-normal">Missed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {missed.biggestMisses.slice(0, 5).map((m) => (
                      <tr key={m.transactionId}>
                        <td className="py-2">
                          <div>
                            {m.merchant} · <Money value={cents(m.amount)} />
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {m.date} · used {m.usedCard}, best {m.bestCard}
                          </div>
                        </td>
                        <td className="py-2 text-right">
                          <Money value={cents(m.missed)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {ytd.byCategory.length > 0 && <Breakdown ytd={ytd} />}
    </div>
  );
}
