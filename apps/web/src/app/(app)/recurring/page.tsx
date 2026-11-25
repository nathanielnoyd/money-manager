import { formatMoney, monthlyCost } from "@mm/core";
import { refreshRecurring } from "@mm/db";
import { Repeat } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { hasRole, inHousehold } from "@/lib/household";
import { listRecurring } from "@/lib/recurring";
import { RecurringList } from "./recurring-list";

export const metadata = { title: "Recurring" };

export default async function RecurringPage() {
  const { rows, canEdit } = await inHousehold(async (tx, s) => {
    // Detection is cheap (one household, ~13 months) so keep it fresh on every visit.
    await refreshRecurring(tx, s.householdId);
    return { rows: await listRecurring(tx), canEdit: hasRole(s, "member") };
  });
  const active = rows.filter((r) => r.status === "active");
  const outflow = active.filter((r) => r.direction === "out");
  const inflow = active.filter((r) => r.direction === "in");
  const monthlyOut = outflow.reduce(
    (t, r) => t + monthlyCost({ cadence: r.cadence as never, expectedAmount: r.expectedAmount }),
    0,
  );
  const monthlyIn = inflow.reduce(
    (t, r) => t + monthlyCost({ cadence: r.cadence as never, expectedAmount: r.expectedAmount }),
    0,
  );
  const increases = outflow.filter((r) => (r.priceChange ?? 0) < 0);

  return (
    <>
      <PageHeader
        title="Recurring"
        description="Subscriptions, bills and regular income, detected from your history."
      />
      {rows.length === 0 ? (
        <EmptyState icon={Repeat} title="Nothing recurring yet">
          After a few months of transactions, subscriptions and bills show up here automatically.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardContent className="p-5">
                <div className="text-sm text-muted-foreground">Bills &amp; subscriptions</div>
                <div className="text-2xl font-semibold tabular">
                  {formatMoney(monthlyOut)}
                  <span className="text-sm font-normal text-muted-foreground"> /mo</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {outflow.length} active · {formatMoney(monthlyOut * 12)} a year
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <div className="text-sm text-muted-foreground">Recurring income</div>
                <div className="text-2xl font-semibold tabular">
                  {formatMoney(monthlyIn)}
                  <span className="text-sm font-normal text-muted-foreground"> /mo</span>
                </div>
                <div className="text-xs text-muted-foreground">{inflow.length} sources</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <div className="text-sm text-muted-foreground">Price increases</div>
                <div
                  className={`text-2xl font-semibold tabular ${increases.length ? "text-warning" : ""}`}
                >
                  {increases.length}
                </div>
                <div className="text-xs text-muted-foreground">
                  {increases.length ? increases.map((r) => r.merchant).join(", ") : "None detected"}
                </div>
              </CardContent>
            </Card>
          </div>
          <RecurringList
            rows={rows.map((r) => ({
              ...r,
              monthly: monthlyCost({
                cadence: r.cadence as never,
                expectedAmount: r.expectedAmount,
              }),
            }))}
            canEdit={canEdit}
          />
        </div>
      )}
    </>
  );
}
