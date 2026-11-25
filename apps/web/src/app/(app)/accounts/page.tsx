import { ACCOUNT_TYPES, type AccountType, isLiability, netWorth } from "@mm/core";
import { Wallet } from "lucide-react";
import { NetWorthBreakdownChart } from "@/components/charts/net-worth-breakdown";
import { EmptyState } from "@/components/empty-state";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireSession } from "@/lib/auth/session";
import { getAccounts, getNetWorthBreakdown } from "@/lib/queries";
import { AddManualAccountButton, EditAccountButton } from "./account-controls";

export const metadata = { title: "Accounts" };

const LABELS: Record<AccountType, string> = {
  depository: "Cash",
  credit: "Credit cards",
  loan: "Loans",
  investment: "Investments",
  property: "Property",
  other: "Other",
};

export default async function AccountsPage() {
  const s = await requireSession();
  const accounts = await getAccounts(s.householdId);
  const breakdown = accounts.length ? await getNetWorthBreakdown(s.householdId) : [];
  if (accounts.length === 0) {
    return (
      <>
        <PageHeader title="Accounts" actions={<AddManualAccountButton />} />
        <EmptyState icon={Wallet} title="No accounts yet">
          Connect a bank under Settings → Connections, import a file from Transactions, or add a
          manual account.
        </EmptyState>
      </>
    );
  }
  return (
    <>
      <PageHeader
        title="Accounts"
        description="Net worth"
        actions={
          <>
            <Money value={netWorth(accounts)} className="mr-2 text-2xl font-semibold" />
            <AddManualAccountButton />
          </>
        }
      />
      {breakdown.length > 1 && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Net worth over time</CardTitle>
          </CardHeader>
          <CardContent>
            <NetWorthBreakdownChart data={breakdown} />
          </CardContent>
        </Card>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {ACCOUNT_TYPES.map((type) => {
          const group = accounts.filter((a) => a.type === type);
          if (group.length === 0) return null;
          const total = group.reduce((t, a) => t + a.currentBalance, 0);
          return (
            <Card key={type}>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>{LABELS[type]}</CardTitle>
                <Money value={isLiability(type) ? -total : total} className="text-sm font-medium" />
              </CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {group.map((a) => (
                    <li key={a.id} className="flex items-center justify-between py-3">
                      <div>
                        <div className="text-sm font-medium">
                          {a.name}
                          {a.hidden && (
                            <span className="ml-2 text-xs text-muted-foreground">(hidden)</span>
                          )}
                          {!a.includeInNetWorth && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              (not in net worth)
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          <span className="capitalize">{a.subtype ?? a.type}</span>
                          {a.mask && ` ··${a.mask}`}
                          {a.balanceUpdatedAt &&
                            ` · updated ${a.balanceUpdatedAt.toLocaleDateString("en-US")}`}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Money
                          value={isLiability(a.type) ? -a.currentBalance : a.currentBalance}
                          className="text-sm font-medium"
                        />
                        <EditAccountButton
                          account={{
                            id: a.id,
                            name: a.name,
                            type: a.type,
                            includeInNetWorth: a.includeInNetWorth,
                            hidden: a.hidden,
                            manual: !a.connectionId,
                            currentBalance: a.currentBalance,
                          }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}
