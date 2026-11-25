import { todayIso } from "@mm/core";
import { computeHouseholdRewards } from "@mm/services";
import { ArrowLeftRight, FileUp } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { householdAiSettings, serverAi } from "@/lib/ai";
import { hasRole, inHousehold } from "@/lib/household";
import {
  accountOptions,
  categoryOptions,
  listTransactions,
  PAGE_SIZE,
  parseFilters,
  splitChildren,
} from "@/lib/transactions";
import { AddTransaction } from "./add-transaction";
import { CategorizeWithAi } from "./categorize-with-ai";
import { Filters } from "./filters";
import { TransactionsTable } from "./transactions-table";

export const metadata = { title: "Transactions" };

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const data = await inHousehold(async (tx, s) => {
    const list = await listTransactions(tx, filters);
    const ai = serverAi() ? await householdAiSettings(tx, s.householdId) : null;
    const children = await splitChildren(
      tx,
      list.rows.filter((r) => r.isSplit).map((r) => r.id),
    );
    const dates = list.rows.map((r) => r.date).sort();
    const rewards = dates.length
      ? await computeHouseholdRewards(tx, {
          start: dates[0] as string,
          end: dates[dates.length - 1] as string,
        })
      : null;
    const cardById = new Map(rewards?.wallet.map((w) => [w.id, w.card]) ?? []);
    const chips = Object.fromEntries(
      (rewards?.lines ?? []).map((l) => {
        const card = cardById.get(l.walletCardId);
        const better =
          l.bestWalletCardId !== l.walletCardId && l.bestValueCents - l.valueCents >= 5
            ? cardById.get(l.bestWalletCardId)
            : undefined;
        return [
          l.transactionId,
          {
            rate: card?.program === "cash_back" ? `${l.multiplier}%` : `${l.multiplier}x`,
            points: l.points,
            valueCents: l.valueCents,
            ...(better ? { better: better.name, betterValueCents: l.bestValueCents } : {}),
          },
        ];
      }),
    );
    return {
      ...list,
      chips,
      aiEnabled: !!ai?.enabled && hasRole(s, "member"),
      canEdit: hasRole(s, "member"),
      children,
      categories: await categoryOptions(tx),
      accounts: await accountOptions(tx),
    };
  });
  const filtered = Object.keys(sp).some((k) => k !== "page");
  const page = filters.page ?? 1;
  const qs = (p: number) => {
    const u = new URLSearchParams(
      Object.entries(sp).flatMap(([k, v]) =>
        typeof v === "string" && k !== "page" ? [[k, v]] : [],
      ),
    );
    if (p > 1) u.set("page", String(p));
    return `/transactions${u.size ? `?${u}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title="Transactions"
        description={`${data.total.toLocaleString()} ${filtered ? "matching" : "total"}`}
        actions={
          <>
            {data.canEdit && (
              <AddTransaction
                accounts={data.accounts.filter((a) => !a.synced)}
                categories={data.categories}
                today={todayIso()}
              />
            )}
            <Button variant="outline" asChild>
              <Link href="/transactions/import">
                <FileUp /> Import
              </Link>
            </Button>
          </>
        }
      />
      <Filters filters={filters} categories={data.categories} accounts={data.accounts} />
      {data.aiEnabled && filters.category === "none" && data.total > 0 && (
        <CategorizeWithAi count={data.total} />
      )}
      {data.rows.length === 0 ? (
        <EmptyState
          icon={ArrowLeftRight}
          title={filtered ? "Nothing matches these filters" : "No transactions yet"}
        >
          {filtered ? (
            "Try a broader search or clear the filters."
          ) : (
            <>
              Connect a bank under{" "}
              <Link href="/settings/connections" className="text-primary hover:underline">
                Settings → Connections
              </Link>
              , or{" "}
              <Link href="/transactions/import" className="text-primary hover:underline">
                import a file
              </Link>
              .
            </>
          )}
        </EmptyState>
      ) : (
        <>
          <TransactionsTable
            rows={data.rows}
            splits={data.children}
            categories={data.categories}
            rewards={data.chips}
          />
          <nav className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {(page - 1) * PAGE_SIZE + 1}–{(page - 1) * PAGE_SIZE + data.rows.length} of{" "}
              {data.total.toLocaleString()}
            </span>
            <div className="flex gap-2">
              {page > 1 && (
                <Button variant="outline" size="sm" asChild>
                  <Link href={qs(page - 1)}>Previous</Link>
                </Button>
              )}
              {data.hasMore && (
                <Button variant="outline" size="sm" asChild>
                  <Link href={qs(page + 1)}>Next</Link>
                </Button>
              )}
            </div>
          </nav>
        </>
      )}
    </>
  );
}
