import { formatMoney } from "@mm/core";
import { TrendingUp } from "lucide-react";
import Link from "next/link";
import { NetWorthChart } from "@/components/dashboard/net-worth-chart";
import { EmptyState } from "@/components/empty-state";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { hasRole, inHousehold } from "@/lib/household";
import { getInvestments, RANGES, type Range } from "@/lib/investments";
import { cn } from "@/lib/utils";
import { HoldingsTable } from "./holdings-table";

export const metadata = { title: "Investments" };

const pct = (p: number | null) =>
  p === null ? "—" : `${p >= 0 ? "+" : ""}${(p * 100).toFixed(1)}%`;

export default async function InvestmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const raw = (await searchParams).range;
  const range: Range = raw && raw in RANGES ? (raw as Range) : "1y";
  const { data, canEdit } = await inHousehold(async (tx, s) => ({
    data: await getInvestments(tx, range),
    canEdit: hasRole(s, "member"),
  }));

  if (!data) {
    return (
      <>
        <PageHeader title="Investments" />
        <EmptyState icon={TrendingUp} title="No investment accounts">
          Connect a brokerage through Plaid, or{" "}
          <Link href="/accounts" className="text-primary hover:underline">
            add a manual investment account
          </Link>{" "}
          and enter your holdings.
        </EmptyState>
      </>
    );
  }
  const perf = data.performance;
  const maxAlloc = Math.max(1, ...data.allocation.map((a) => a.value));

  return (
    <>
      <PageHeader
        title="Investments"
        description={`${data.accounts.length} account${data.accounts.length === 1 ? "" : "s"} · ${data.holdings.length} holdings`}
        actions={
          <nav className="flex rounded-lg border bg-card p-1 shadow-xs" aria-label="Time range">
            {(Object.keys(RANGES) as Range[]).map((r) => (
              <Link
                key={r}
                href={`/investments?range=${r}`}
                aria-current={r === range ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-1 text-sm",
                  r === range
                    ? "bg-muted font-medium"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {r === "all" ? "All" : r.toUpperCase()}
              </Link>
            ))}
          </nav>
        }
      />
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label="Total value">
            <Money value={data.total} className="text-2xl font-semibold tracking-tight" />
          </Tile>
          <Tile
            label="Market gain"
            hint={perf ? `${pct(perf.returnPct)} time-weighted` : "Not enough history yet"}
          >
            <Money
              value={perf?.gain ?? 0}
              signed
              colored
              className="text-2xl font-semibold tracking-tight"
            />
          </Tile>
          <Tile label="Net contributions" hint="Deposits minus withdrawals">
            <Money
              value={perf?.netContributions ?? 0}
              signed
              className="text-2xl font-semibold tracking-tight"
            />
          </Tile>
          <Tile
            label="Unrealized gain"
            hint={
              data.unrealized.coverage < 1
                ? `cost basis known for ${Math.round(data.unrealized.coverage * 100)}% of holdings`
                : `on ${formatMoney(data.unrealized.basis)} invested`
            }
          >
            <span className="flex items-baseline gap-2">
              <Money
                value={data.unrealized.gain}
                signed
                colored
                className="text-2xl font-semibold tracking-tight"
              />
              <span className="text-sm text-muted-foreground">{pct(data.unrealized.pct)}</span>
            </span>
          </Tile>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Portfolio value</CardTitle>
            </CardHeader>
            <CardContent>
              <NetWorthChart data={data.series} label="Portfolio value" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Allocation</CardTitle>
            </CardHeader>
            <CardContent>
              {data.allocation.length === 0 ? (
                <p className="text-sm text-muted-foreground">No holdings reported yet.</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {data.allocation.map((a) => (
                    <li key={a.assetClass}>
                      <div className="mb-1 flex justify-between text-sm">
                        <span>{a.assetClass}</span>
                        <span className="text-muted-foreground tabular">
                          {Math.round(a.share * 100)}% ·{" "}
                          {formatMoney(a.value, "USD", { compact: true })}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-muted">
                        <div
                          className="h-2 rounded-full bg-chart-1"
                          style={{ width: `${(a.value / maxAlloc) * 100}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <HoldingsTable
          holdings={data.holdings}
          manualAccounts={
            canEdit
              ? data.accounts.filter((a) => a.manual).map((a) => ({ id: a.id, name: a.name }))
              : []
          }
          manualAccountIds={data.accounts.filter((a) => a.manual).map((a) => a.id)}
        />
        <p className="text-xs text-muted-foreground">
          Market gain = change in value minus your net contributions (Modified Dietz). Prices come
          from your brokerage at each sync; manual holdings use the value you enter.
        </p>
      </div>
    </>
  );
}

function Tile({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="text-sm text-muted-foreground">{label}</div>
        {children}
        {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}
