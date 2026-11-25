import { addMonths, firstOfMonth, formatMoney, monthLabel, todayIso } from "@mm/core";
import { Waves } from "lucide-react";
import Link from "next/link";
import { CashFlowChart } from "@/components/charts/cash-flow-chart";
import { EmptyState } from "@/components/empty-state";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { inHousehold } from "@/lib/household";
import { getCashFlow } from "@/lib/planning";
import { cn } from "@/lib/utils";

export const metadata = { title: "Cash flow" };

const RANGES = { "3m": 3, "6m": 6, "12m": 12, ytd: 0 } as const;
type Range = keyof typeof RANGES;

export default async function CashFlowPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const raw = (await searchParams).range;
  const range: Range = raw && raw in RANGES ? (raw as Range) : "12m";
  const today = todayIso();
  const from =
    range === "ytd"
      ? `${today.slice(0, 4)}-01-01`
      : addMonths(firstOfMonth(today), -(RANGES[range] - 1));
  const data = await inHousehold((tx) => getCashFlow(tx, from, today));
  const maxCat = Math.max(1, ...data.byCategory.map((c) => c.spent));

  return (
    <>
      <PageHeader
        title="Cash flow"
        description={`${monthLabel(from)} – ${monthLabel(today)} · transfers excluded`}
        actions={
          <nav className="flex rounded-lg border bg-card p-1 shadow-xs" aria-label="Time range">
            {(Object.keys(RANGES) as Range[]).map((r) => (
              <Link
                key={r}
                href={`/cash-flow?range=${r}`}
                aria-current={r === range ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-1 text-sm",
                  r === range
                    ? "bg-muted font-medium"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {r === "ytd" ? "YTD" : r.toUpperCase()}
              </Link>
            ))}
          </nav>
        }
      />
      {data.series.length === 0 ? (
        <EmptyState icon={Waves} title="No activity in this range">
          Connect a bank or import transactions to see your cash flow.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-4">
            <Tile label="Income" value={data.income} />
            <Tile label="Expenses" value={data.expense} />
            <Tile
              label={data.net >= 0 ? "Saved" : "Overspent"}
              value={Math.abs(data.net)}
              className={data.net >= 0 ? "text-positive" : "text-negative"}
            />
            <Card>
              <CardContent className="p-5">
                <div className="text-sm text-muted-foreground">Savings rate</div>
                <div className="text-2xl font-semibold tracking-tight tabular">
                  {data.savingsRate === null ? "—" : `${Math.round(data.savingsRate * 100)}%`}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Income vs. expenses by month</CardTitle>
            </CardHeader>
            <CardContent>
              <CashFlowChart data={data.series} />
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
            <Card>
              <CardHeader>
                <CardTitle>Spending by category</CardTitle>
              </CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <caption className="sr-only">Spending by category for the selected range</caption>
                  <thead className="sr-only">
                    <tr>
                      <th>Category</th>
                      <th>Share</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byCategory.map((c) => (
                      <tr key={c.id ?? "none"} className="group">
                        <td className="w-40 py-1.5 pr-3 align-middle">
                          {c.id ? (
                            <Link
                              href={`/transactions?category=${c.id}&from=${from}`}
                              className="hover:underline"
                            >
                              {c.name}
                            </Link>
                          ) : (
                            <Link
                              href={`/transactions?category=none&from=${from}`}
                              className="text-warning hover:underline"
                            >
                              {c.name}
                            </Link>
                          )}
                          <div className="text-xs text-muted-foreground">{c.group}</div>
                        </td>
                        <td className="py-1.5 align-middle">
                          <div className="h-2 rounded-full bg-muted">
                            <div
                              className="h-2 rounded-full bg-chart-1"
                              style={{ width: `${(c.spent / maxCat) * 100}%` }}
                            />
                          </div>
                        </td>
                        <td className="w-28 py-1.5 pl-3 text-right align-middle">
                          <Money value={c.spent} className="font-medium" />
                          <div className="text-xs text-muted-foreground tabular">
                            {Math.round((c.spent / Math.max(1, data.expense)) * 100)}%
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Top merchants</CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="divide-y">
                  {data.byMerchant.map((m, i) => (
                    <li key={m.name} className="flex items-center gap-3 py-2 text-sm">
                      <span className="w-5 text-xs text-muted-foreground tabular">{i + 1}</span>
                      <Link
                        href={`/transactions?q=${encodeURIComponent(m.name)}&from=${from}`}
                        className="flex-1 truncate hover:underline"
                      >
                        {m.name}
                      </Link>
                      <span className="text-xs text-muted-foreground">{m.count}×</span>
                      <Money value={m.spent} className="w-24 text-right font-medium" />
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          </div>
          <p className="text-xs text-muted-foreground">
            Average monthly spending (months with activity):{" "}
            {formatMoney(
              Math.round(
                data.expense / Math.max(1, data.series.filter((m) => m.expense > 0).length),
              ),
            )}
          </p>
        </div>
      )}
    </>
  );
}

function Tile({ label, value, className }: { label: string; value: number; className?: string }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="text-sm text-muted-foreground">{label}</div>
        <Money value={value} className={cn("text-2xl font-semibold tracking-tight", className)} />
      </CardContent>
    </Card>
  );
}
