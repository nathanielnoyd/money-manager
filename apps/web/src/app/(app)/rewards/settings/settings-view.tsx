"use client";

import { type Categories, CategoryMap, PointValues, type Programs, useRun } from "../components";
import { CatalogSection, type EditedEntry } from "./catalog-view";

type CatalogProps = Omit<
  React.ComponentProps<typeof CatalogSection>,
  "isOwner" | "disabled" | "run"
>;

export function SettingsView({
  canEdit,
  isOwner,
  categories,
  programs,
  catalog,
}: {
  canEdit: boolean;
  isOwner: boolean;
  categories: Categories;
  programs: Programs;
  catalog: CatalogProps & { edited: EditedEntry[] };
}) {
  const { run, disabled, banner } = useRun(canEdit);
  return (
    <div className="flex flex-col gap-4">
      {banner}
      <CategoryMap categories={categories} disabled={disabled} run={run} />
      <PointValues programs={programs} disabled={disabled} run={run} />
      <CatalogSection {...catalog} isOwner={isOwner} disabled={disabled} run={run} />
    </div>
  );
}
