import { PageHeader } from "@/components/page-header";
import { RewardsTabs } from "./tabs";

export default function RewardsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader
        title="Rewards"
        description="Points, miles and cash back your cards earn, valued in dollars."
      />
      <RewardsTabs />
      {children}
    </>
  );
}
