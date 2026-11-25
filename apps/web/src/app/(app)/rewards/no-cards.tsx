import { CreditCard } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";

export function NoCards() {
  return (
    <EmptyState icon={CreditCard} title="No credit cards yet">
      Rewards are tracked on credit card accounts. Connect a bank under{" "}
      <Link href="/settings/connections" className="text-primary hover:underline">
        Settings → Connections
      </Link>{" "}
      or add a manual credit card account on the{" "}
      <Link href="/accounts" className="text-primary hover:underline">
        Accounts
      </Link>{" "}
      page.
    </EmptyState>
  );
}
