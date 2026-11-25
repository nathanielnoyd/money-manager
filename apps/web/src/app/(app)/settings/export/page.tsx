import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { requireSession } from "@/lib/auth/session";
import { hasRole } from "@/lib/household";
import { ExportButtons } from "./export-buttons";

export const metadata = { title: "Export" };

export default async function ExportPage() {
  const s = await requireSession();
  return (
    <>
      <PageHeader
        title="Export"
        description="Your data is yours. Download it to keep a copy or to move to another tool."
      />
      <Card>
        <CardHeader>
          <h2 className="font-semibold">Download your data</h2>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            <li>
              <strong className="text-foreground">Transactions (CSV)</strong> opens in any
              spreadsheet: date, account, merchant, category, amount and notes, one row per
              transaction. Splits are written as their parts.
            </li>
            <li>
              <strong className="text-foreground">Everything (JSON)</strong> is the complete record:
              accounts and balance history, categories, rules, budgets, goals, recurring bills,
              holdings and card rewards settings, as well as every transaction.
            </li>
          </ul>
          <p className="text-muted-foreground">
            Bank credentials, agent tokens and sign-in details are never included. The files are not
            encrypted, so store them somewhere safe.
          </p>
          {hasRole(s, "owner") ? (
            <ExportButtons />
          ) : (
            <p className="text-muted-foreground">Only the household owner can export.</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
