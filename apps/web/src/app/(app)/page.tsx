import { formatMoney, isLiability } from "@mm/core";
import { ArrowDownRight, ArrowUpRight, Database } from "lucide-react";
import Link from "next/link";
import { InsightsCard } from "@/components/dashboard/insights-card";
import { NetWorthChart } from "@/components/dashboard/net-worth-chart";
import { EmptyState } from "@/components/empty-state";
import { Money } from "@/components/money";
import { TransactionList } from "@/components/transaction-list";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireSession } from "@/lib/auth/session";
import { inHousehold } from "@/lib/household";
import { getInsights } from "@/lib/insights";
import { getBudgetMonth, parseMonth } from "@/lib/planning";
import { getDashboard } from "@/lib/queries";
import { upcoming } from "@/lib/recurring";
import { cn } from "@/lib/utils";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const s = await requireSession();
  const d = await getDashboard(s.householdId);
  const { bills, budget, insights } = await inHousehold(async (tx, sess) => ({
    bills: await upcoming(tx, 14),
    budget: await getBudgetMonth(tx, s.householdId, parseMonth(undefined)),
    insights: await getInsights(tx, sess),
  }));
  const firstName = s.displayName.split(" ")[0];

  if (d.accounts.length === 0) {
    return (
      <>
        <Greeting name={firstName} />
        <EmptyState icon={Database} title="No accounts yet">
          <Link href="/settings/connections" className="text-primary hover:underline">
            Connect a bank
          </Link>
          ,{" "}
          <Link href="/transactions/import" className="text-primary hover:underline">
            import a file
          </Link>
          , or{" "}
          <Link href="/accounts" className="text-primary hover:underline">
            add a manual account
          </Link>{" "}
          to get started.
        </EmptyState>
      </>
    );
  }

  const up = d.netWorthChange30d >= 0;
  const spendDelta = d.spentThisMonth - d.spentLastMonth;
  const assets = d.accounts
    .filter((a) => a.includeInNetWorth && !isLiability(a.type))
    .reduce((t, a) => t + a.currentBalance, 0);
  const liabilities = d.accounts
    .filter((a) => a.includeInNetWorth && isLiability(a.type))
    .reduce((t, a) => t + a.currentBalance, 0);
  const maxCat = Math.max(1, ...d.byCategory.map((c) => c.spent));

  return (
    <>
      <Greeting name={firstName} />
      <InsightsCard data={insights} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Net worth</CardTitle>
            <div className="flex flex-wrap items-baseline gap-3">
              <Money value={d.netWorth} className="text-3xl font-semibold tracking-tight" />
              <span
                className={cn(
                  "inline-flex items-center gap-0.5 text-sm font-medium",
                  up ? "text-positive" : "text-negative",
                )}
              >
                {up ? <ArrowUpRight className="size-4" /> : <ArrowDownRight className="size-4" />}
                {formatMoney(Math.abs(d.netWorthChange30d))} · 30 days
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <NetWorthChart data={d.series} />
            <div className="mt-4 grid grid-cols-2 gap-4 border-t pt-4 text-sm">
              <div>
                <div className="text-muted-foreground">Assets</div>
                <Money value={assets} className="font-medium" />
              </div>
              <div>
                <div className="text-muted-foreground">Liabilities</div>
                <Money value={liabilities} className="font-medium" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Spending this month</CardTitle>
            <Money value={d.spentThisMonth} className="text-3xl font-semibold tracking-tight" />
            <p className="text-sm text-muted-foreground">
              <span className={spendDelta > 0 ? "text-negative" : "text-positive"}>
                {formatMoney(Math.abs(spendDelta))} {spendDelta > 0 ? "more" : "less"}
              </span>{" "}
              than this point last month
            </p>
          </CardHeader>
          <CardContent>
            <ul className="mt-2 flex flex-col gap-3">
              {d.byCategory.map((c) => (
                <li key={c.name}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span>{c.name}</span>
                    <Money value={c.spent} className="text-muted-foreground" />
                  </div>
                  <div className="h-1.5 rounded-full bg-muted">
                    <div
                      className="h-1.5 rounded-full bg-chart-1"
                      style={{ width: `${(c.spent / maxCat) * 100}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Recent transactions</CardTitle>
            <Link href="/transactions" className="text-sm text-primary hover:underline">
              View all
            </Link>
          </CardHeader>
          <CardContent>
            <TransactionList rows={d.recent} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Accounts</CardTitle>
            <Link href="/accounts" className="text-sm text-primary hover:underline">
              Manage
            </Link>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {d.accounts.map((a) => (
                <li key={a.id} className="flex items-center justify-between py-2.5 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{a.name}</div>
                    <div className="text-xs capitalize text-muted-foreground">
                      {a.subtype ?? a.type}
                      {a.mask && ` ··${a.mask}`}
                    </div>
                  </div>
                  <Money
                    value={isLiability(a.type) ? -a.currentBalance : a.currentBalance}
                    className="font-medium"
                  />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Upcoming · 14 days</CardTitle>
            <Link href="/recurring" className="text-sm text-primary hover:underline">
              All recurring
            </Link>
          </CardHeader>
          <CardContent>
            {bills.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing expected in the next two weeks.
              </p>
            ) : (
              <ul className="divide-y">
                {bills.map((b) => (
                  <li key={b.id} className="flex items-center justify-between py-2 text-sm">
                    <div>
                      <div className="font-medium">{b.merchant}</div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(`${b.nextDate}T00:00:00Z`).toLocaleDateString("en-US", {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          timeZone: "UTC",
                        })}
                      </div>
                    </div>
                    <Money value={b.amount} signed colored className="font-medium" />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Budget · this month</CardTitle>
            <Link href="/budget" className="text-sm text-primary hover:underline">
              Open budget
            </Link>
          </CardHeader>
          <CardContent>
            {budget.totals.budgeted === 0 ? (
              <p className="text-sm text-muted-foreground">
                No budget yet.{" "}
                <Link href="/budget" className="text-primary hover:underline">
                  Set one up
                </Link>{" "}
                in under a minute with "Fill from 3-month average".
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex items-baseline justify-between text-sm">
                  <span>
                    <Money value={budget.totals.spent} className="text-xl font-semibold" />{" "}
                    <span className="text-muted-foreground">
                      of {formatMoney(budget.totals.budgeted)}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "text-sm",
                      budget.totals.spent > budget.totals.budgeted
                        ? "text-negative"
                        : "text-muted-foreground",
                    )}
                  >
                    {budget.totals.spent > budget.totals.budgeted
                      ? `${formatMoney(budget.totals.spent - budget.totals.budgeted)} over`
                      : `${formatMoney(budget.totals.budgeted - budget.totals.spent)} left`}
                  </span>
                </div>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {budget.expense
                    .filter((l) => l.line.budgeted > 0)
                    .sort((a, b) => b.line.progress - a.line.progress)
                    .slice(0, 6)
                    .map((l) => (
                      <li key={l.id}>
                        <div className="mb-1 flex justify-between text-xs">
                          <span>{l.name}</span>
                          <span
                            className={cn(
                              "tabular",
                              l.line.status === "over" ? "text-negative" : "text-muted-foreground",
                            )}
                          >
                            {Math.round(Math.min(9.99, l.line.progress) * 100)}%
                          </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                          <div
                            className={cn(
                              "h-full rounded-full",
                              l.line.status === "over"
                                ? "bg-negative"
                                : l.line.status === "near"
                                  ? "bg-warning"
                                  : "bg-primary",
                            )}
                            style={{ width: `${Math.max(2, Math.min(1, l.line.progress) * 100)}%` }}
                          />
                        </div>
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Greeting({ name }: { name?: string }) {
  const h = new Date().getHours();
  const part = h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        Good {part}
        {name ? `, ${name}` : ""}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">Here's where things stand.</p>
    </div>
  );
}
