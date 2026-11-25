import {
  execute,
  householdCatalog,
  householdRewardsSettings,
  listCatalogChanges,
  listRewardCategories,
  listRewardPrograms,
} from "@mm/services";
import { db } from "@/lib/db";
import { inHousehold } from "@/lib/household";
import { rewardsContext } from "../data";
import type { EditedEntry } from "./catalog-view";
import { SettingsView } from "./settings-view";

export const metadata = { title: "Settings · Rewards" };

export default async function RewardsSettings() {
  const { p, canEdit } = await rewardsContext();
  const [categories, programs, history, pending, local] = await Promise.all([
    execute(db(), p, listRewardCategories, {}),
    execute(db(), p, listRewardPrograms, {}),
    execute(db(), p, listCatalogChanges, { limit: 30 }),
    execute(db(), p, listCatalogChanges, { status: "pending", limit: 50 }),
    inHousehold(async (tx) => {
      const [catalog, settings] = await Promise.all([
        householdCatalog(tx),
        householdRewardsSettings(tx),
      ]);
      const edited: EditedEntry[] = [...catalog.overridden.entries()].map(([key, o]) => {
        const [entity, slug] = key.split(":") as ["card" | "program", string];
        const name =
          (entity === "card" ? catalog.card(slug)?.name : catalog.program(slug)?.name) ?? slug;
        return { entity, slug, name, custom: o.custom };
      });
      return { edited, requireApproval: settings.requireCatalogApproval };
    }),
  ]);
  return (
    <SettingsView
      canEdit={canEdit}
      isOwner={p.role === "owner"}
      categories={categories}
      programs={programs}
      catalog={{
        changes: history.changes.filter((c) => c.status !== "pending"),
        pending: pending.changes,
        ...local,
      }}
    />
  );
}
