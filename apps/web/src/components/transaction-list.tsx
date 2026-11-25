import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";

export interface TxnRow {
  id: string;
  date: string;
  amount: number;
  pending: boolean;
  raw: string;
  merchant: string | null;
  category: string | null;
  account: string;
}

export function TransactionList({
  rows,
  showAccount = true,
}: {
  rows: TxnRow[];
  showAccount?: boolean;
}) {
  return (
    <ul className="divide-y">
      {rows.map((t) => (
        <li key={t.id} className="flex items-center gap-4 py-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
            {(t.merchant ?? t.raw).slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">{t.merchant ?? t.raw}</span>
              {t.pending && <Badge tone="warning">Pending</Badge>}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {t.category ?? "Uncategorized"}
              {showAccount && ` · ${t.account}`}
            </div>
          </div>
          <div className="text-right">
            <Money value={t.amount} signed colored className="text-sm font-medium" />
            <div className="text-xs text-muted-foreground tabular">{formatDate(t.date)}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export const formatDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
