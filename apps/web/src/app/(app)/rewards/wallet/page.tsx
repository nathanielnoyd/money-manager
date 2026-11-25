import {
  execute,
  getCardValues,
  getSignupBonusProgress,
  listPointsBalances,
  listRewardPrograms,
} from "@mm/services";
import { db } from "@/lib/db";
import { catalogOptions, rewardsContext } from "../data";
import { NoCards } from "../no-cards";
import { WalletView } from "./wallet-view";

export const metadata = { title: "Wallet · Rewards" };

export default async function RewardsWallet() {
  const { p, canEdit, wallet, hasCredit } = await rewardsContext();
  if (!hasCredit) return <NoCards />;
  const [values, bonuses, balances, programs] = await Promise.all([
    execute(db(), p, getCardValues, {}),
    execute(db(), p, getSignupBonusProgress, {}),
    execute(db(), p, listPointsBalances, {}),
    execute(db(), p, listRewardPrograms, {}),
  ]);
  return (
    <WalletView
      canEdit={canEdit}
      wallet={wallet}
      values={values}
      bonuses={bonuses}
      balances={balances}
      programs={programs.programs
        .filter((x) => x.kind !== "cash_back")
        .map((x) => ({ slug: x.slug, name: x.name }))}
      catalog={await catalogOptions()}
    />
  );
}
