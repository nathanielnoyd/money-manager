export interface CategoryOption {
  id: string;
  name: string;
  group: string;
  hidden: boolean;
}

/** <option>s grouped by category group, for any <select>. */
export function CategorySelectOptions({
  categories,
  includeHiddenId,
}: {
  categories: CategoryOption[];
  includeHiddenId?: string | null;
}) {
  const groups = new Map<string, CategoryOption[]>();
  for (const c of categories) {
    if (c.hidden && c.id !== includeHiddenId) continue;
    groups.set(c.group, [...(groups.get(c.group) ?? []), c]);
  }
  return (
    <>
      {[...groups].map(([group, cats]) => (
        <optgroup key={group} label={group}>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}
