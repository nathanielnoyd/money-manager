import { MonthSwitcher } from "@/components/month-switcher";
import { PageHeader } from "@/components/page-header";
import { hasRole, inHousehold } from "@/lib/household";
import { getBudgetMonth, parseMonth } from "@/lib/planning";
import { BudgetEditor } from "./budget-editor";

export const metadata = { title: "Budget" };

export default async function BudgetPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const month = parseMonth((await searchParams).month);
  const { data, canEdit } = await inHousehold(async (tx, s) => ({
    data: await getBudgetMonth(tx, s.householdId, month),
    canEdit: hasRole(s, "member"),
  }));
  return (
    <>
      <PageHeader
        title="Budget"
        description={
          data.budgetMode === "zero_based"
            ? "Zero-based: give every dollar of income a job."
            : "Set limits for the categories you care about."
        }
        actions={<MonthSwitcher month={month} basePath="/budget" />}
      />
      <BudgetEditor key={month} data={data} canEdit={canEdit} />
    </>
  );
}
