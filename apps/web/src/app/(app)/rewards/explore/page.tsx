import { execute, recommendCards } from "@mm/services";
import { db } from "@/lib/db";
import { catalogOptions, rewardsContext } from "../data";
import { NoCards } from "../no-cards";
import { ExploreView } from "./explore-view";

export const metadata = { title: "Explore cards · Rewards" };

export default async function RewardsExplore({
  searchParams,
}: {
  searchParams: Promise<{ business?: string }>;
}) {
  const { p, hasCredit } = await rewardsContext();
  if (!hasCredit) return <NoCards />;
  const business = (await searchParams).business === "1";
  const recs = await execute(db(), p, recommendCards, { limit: 8, includeBusiness: business });
  return <ExploreView recs={recs} business={business} catalog={await catalogOptions()} />;
}
