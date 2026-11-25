import { PageHeader } from "@/components/page-header";
import { listGoals } from "@/lib/goals";
import { hasRole, inHousehold } from "@/lib/household";
import { GoalsView } from "./goals-view";

export const metadata = { title: "Goals" };

export default async function GoalsPage() {
  const { data, canEdit } = await inHousehold(async (tx, s) => ({
    data: await listGoals(tx),
    canEdit: hasRole(s, "member"),
  }));
  return (
    <>
      <PageHeader
        title="Goals"
        description="Track savings targets against real account balances."
      />
      <GoalsView data={data} canEdit={canEdit} />
    </>
  );
}
