"use client";

import { formatMoney, parseDecimalToMinor, type RuleCondition } from "@mm/core";
import { Loader2, Pencil, Play, Plus, Trash2, Wand2 } from "lucide-react";
import { useState, useTransition } from "react";
import { type CategoryOption, CategorySelectOptions } from "@/components/category-select";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Checkbox, Field, Select } from "@/components/ui/fields";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { deleteRule, type RuleInput, runAllRules, saveRule, toggleRule } from "./actions";

interface RuleRow {
  id: string;
  name: string;
  priority: number;
  enabled: boolean;
  conditions: RuleCondition[];
  actions: Record<string, unknown>;
}

const FIELD_LABEL: Record<RuleCondition["field"], string> = {
  description: "Description",
  merchant: "Merchant",
  amount: "Amount",
  direction: "Direction",
  account: "Account",
};
const OP_LABEL: Record<string, string> = {
  contains: "contains",
  equals: "is",
  starts_with: "starts with",
  contains_any: "contains any of",
  gt: "is over",
  lt: "is under",
  between: "is between",
};

export function RulesEditor({
  rules,
  categories,
  accounts,
}: {
  rules: RuleRow[];
  categories: CategoryOption[];
  accounts: { id: string; name: string }[];
}) {
  const [editing, setEditing] = useState<RuleRow | "new" | null>(null);
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const acctName = new Map(accounts.map((a) => [a.id, a.name]));

  const describeCondition = (c: RuleCondition) => {
    if (c.field === "amount") {
      const v = formatMoney(Number(c.value));
      return `amount ${OP_LABEL[c.op]} ${v}${c.op === "between" ? ` and ${formatMoney(Number(c.value2 ?? 0))}` : ""}`;
    }
    if (c.field === "direction") return c.value === "in" ? "money in" : "money out";
    if (c.field === "account")
      return `account is ${acctName.get(String(c.value)) ?? "a deleted account"}`;
    return `${FIELD_LABEL[c.field].toLowerCase()} ${OP_LABEL[c.op]} “${c.value}”`;
  };
  const describeActions = (a: Record<string, unknown>) =>
    [
      a.setCategoryId !== undefined &&
        `category → ${a.setCategoryId ? (catName.get(String(a.setCategoryId)) ?? "?") : "Uncategorized"}`,
      a.setMerchantName && `merchant → ${a.setMerchantName}`,
      a.markReviewed && "mark reviewed",
      a.exclude && "exclude",
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap justify-end gap-2">
        {rules.length > 0 && (
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await runAllRules();
                setNotice(
                  r.ok ? `Updated ${r.data?.applied ?? 0} transactions.` : "Couldn't run rules.",
                );
              })
            }
          >
            {pending ? <Loader2 className="animate-spin" /> : <Play />} Run all rules on existing
          </Button>
        )}
        <Button onClick={() => setEditing("new")}>
          <Plus /> New rule
        </Button>
      </div>
      {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
      {rules.length === 0 ? (
        <EmptyState icon={Wand2} title="No rules yet">
          Create one here, or tick “Always categorize this merchant” when editing a transaction.
        </EmptyState>
      ) : (
        <Card className="divide-y">
          {rules.map((r) => (
            <div
              key={r.id}
              className={cn("flex items-center gap-4 p-4", !r.enabled && "opacity-55")}
            >
              <Checkbox
                checked={r.enabled}
                aria-label={`Enable ${r.name}`}
                onChange={(e) => start(async () => void (await toggleRule(r.id, e.target.checked)))}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 font-medium">
                  {r.name} <Badge>#{r.priority}</Badge>
                </div>
                <div className="text-sm text-muted-foreground">
                  When {r.conditions.map(describeCondition).join(" and ")} →{" "}
                  {describeActions(r.actions)}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Edit ${r.name}`}
                onClick={() => setEditing(r)}
              >
                <Pencil />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Delete ${r.name}`}
                onClick={() =>
                  window.confirm(`Delete rule “${r.name}”?`) &&
                  start(async () => void (await deleteRule(r.id)))
                }
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </Card>
      )}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        {editing !== null && (
          <RuleForm
            key={editing === "new" ? "new" : editing.id}
            rule={editing === "new" ? null : editing}
            categories={categories}
            accounts={accounts}
            onDone={(msg) => {
              setEditing(null);
              setNotice(msg);
            }}
          />
        )}
      </Dialog>
    </div>
  );
}

interface CondDraft {
  field: RuleCondition["field"];
  op: string;
  value: string;
  value2: string;
}

function toDraft(c: RuleCondition): CondDraft {
  const money = (n: unknown) => (Number(n) / 100).toFixed(2);
  return {
    field: c.field,
    op: c.op,
    value: c.field === "amount" ? money(c.value) : String(c.value),
    value2: c.value2 !== undefined ? money(c.value2) : "",
  };
}

function RuleForm({
  rule,
  categories,
  accounts,
  onDone,
}: {
  rule: RuleRow | null;
  categories: CategoryOption[];
  accounts: { id: string; name: string }[];
  onDone: (msg: string | null) => void;
}) {
  const [name, setName] = useState(rule?.name ?? "");
  const [priority, setPriority] = useState(String(rule?.priority ?? 0));
  const [conds, setConds] = useState<CondDraft[]>(
    rule?.conditions.map(toDraft) ?? [{ field: "merchant", op: "contains", value: "", value2: "" }],
  );
  const a = rule?.actions ?? {};
  const [category, setCategory] = useState<string>(
    a.setCategoryId === undefined ? "" : String(a.setCategoryId ?? "none"),
  );
  const [merchant, setMerchant] = useState(String(a.setMerchantName ?? ""));
  const [reviewed, setReviewed] = useState(Boolean(a.markReviewed));
  const [exclude, setExclude] = useState(Boolean(a.exclude));
  const [applyNow, setApplyNow] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const opsFor = (f: CondDraft["field"]) =>
    f === "amount"
      ? ["equals", "gt", "lt", "between"]
      : f === "direction" || f === "account"
        ? ["equals"]
        : ["contains", "contains_any", "equals", "starts_with"];
  const update = (i: number, patch: Partial<CondDraft>) =>
    setConds(
      conds.map((c, j) => {
        if (j !== i) return c;
        const next = { ...c, ...patch };
        if (patch.field) {
          next.op = opsFor(patch.field)[0] as string;
          next.value =
            patch.field === "direction"
              ? "out"
              : patch.field === "account"
                ? (accounts[0]?.id ?? "")
                : "";
        }
        return next;
      }),
    );

  function submit() {
    const conditions = conds.map((c) =>
      c.field === "amount"
        ? {
            field: c.field,
            op: c.op,
            value: Math.abs(parseDecimalToMinor(c.value) ?? 0),
            ...(c.op === "between" ? { value2: Math.abs(parseDecimalToMinor(c.value2) ?? 0) } : {}),
          }
        : { field: c.field, op: c.op, value: c.value },
    ) as RuleInput["conditions"];
    start(async () => {
      setError(null);
      const r = await saveRule({
        id: rule?.id,
        name: name || "Untitled rule",
        priority: Math.max(0, Math.min(1000, Number(priority) || 0)),
        enabled: rule?.enabled ?? true,
        conditions,
        actions: {
          ...(category ? { setCategoryId: category === "none" ? null : category } : {}),
          ...(merchant.trim() ? { setMerchantName: merchant.trim() } : {}),
          ...(reviewed ? { markReviewed: true } : {}),
          ...(exclude ? { exclude: true } : {}),
        },
        applyToExisting: applyNow,
      });
      if (!r.ok) return setError(r.error);
      onDone(
        applyNow
          ? `Rule saved; updated ${r.data?.applied ?? 0} existing transactions.`
          : "Rule saved.",
      );
    });
  }

  return (
    <DialogContent title={rule ? "Edit rule" : "New rule"} className="max-w-2xl">
      <div className="flex flex-col gap-5">
        <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
          <Field label="Name" htmlFor="r-name">
            <Input
              id="r-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              placeholder="e.g. Coffee shops"
            />
          </Field>
          <Field label="Priority" htmlFor="r-pri" hint="Lower runs first">
            <Input
              id="r-pri"
              inputMode="numeric"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            />
          </Field>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">When all of these match</span>
          {conds.map((c, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: draft rows have no identity
            <div key={i} className="flex flex-wrap gap-2">
              <Select
                aria-label="Field"
                value={c.field}
                onChange={(e) => update(i, { field: e.target.value as CondDraft["field"] })}
                className="w-36"
              >
                {Object.entries(FIELD_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
              {opsFor(c.field).length > 1 && (
                <Select
                  aria-label="Operator"
                  value={c.op}
                  onChange={(e) => update(i, { op: e.target.value })}
                  className="w-36"
                >
                  {opsFor(c.field).map((o) => (
                    <option key={o} value={o}>
                      {OP_LABEL[o]}
                    </option>
                  ))}
                </Select>
              )}
              {c.field === "direction" ? (
                <Select
                  aria-label="Direction"
                  value={c.value}
                  onChange={(e) => update(i, { value: e.target.value })}
                  className="w-40"
                >
                  <option value="out">Money out</option>
                  <option value="in">Money in</option>
                </Select>
              ) : c.field === "account" ? (
                <Select
                  aria-label="Account"
                  value={c.value}
                  onChange={(e) => update(i, { value: e.target.value })}
                  className="flex-1"
                >
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  aria-label="Value"
                  value={c.value}
                  onChange={(e) => update(i, { value: e.target.value })}
                  className="min-w-32 flex-1"
                  inputMode={c.field === "amount" ? "decimal" : undefined}
                  placeholder={
                    c.field === "amount"
                      ? "0.00"
                      : c.op === "contains_any"
                        ? "UBER | LYFT | CABIFY"
                        : "text"
                  }
                />
              )}
              {c.field === "amount" && c.op === "between" && (
                <Input
                  aria-label="Upper amount"
                  value={c.value2}
                  onChange={(e) => update(i, { value2: e.target.value })}
                  className="w-28"
                  inputMode="decimal"
                  placeholder="0.00"
                />
              )}
              <Button
                variant="ghost"
                size="icon"
                aria-label="Remove condition"
                disabled={conds.length <= 1}
                onClick={() => setConds(conds.filter((_, j) => j !== i))}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={() =>
              setConds([...conds, { field: "description", op: "contains", value: "", value2: "" }])
            }
          >
            <Plus /> Add condition
          </Button>
        </div>

        <div className="grid gap-4 border-t pt-4 sm:grid-cols-2">
          <Field label="Set category" htmlFor="r-cat">
            <Select id="r-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Don't change</option>
              <option value="none">Uncategorized</option>
              <CategorySelectOptions categories={categories} />
            </Select>
          </Field>
          <Field label="Rename merchant to" htmlFor="r-merchant">
            <Input
              id="r-merchant"
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
              maxLength={120}
              placeholder="Don't change"
            />
          </Field>
        </div>
        <div className="flex flex-wrap gap-6 text-sm">
          <label className="flex items-center gap-2">
            <Checkbox checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} /> Mark as
            reviewed
          </label>
          <label className="flex items-center gap-2">
            <Checkbox checked={exclude} onChange={(e) => setExclude(e.target.checked)} /> Exclude
            from reports
          </label>
          <label className="flex items-center gap-2">
            <Checkbox checked={applyNow} onChange={(e) => setApplyNow(e.target.checked)} /> Apply to
            existing transactions
          </label>
        </div>
        {error && (
          <p role="alert" className="text-sm text-negative">
            {error}
          </p>
        )}
        <div className="flex gap-2 border-t pt-4">
          <Button onClick={submit} disabled={pending}>
            {pending && <Loader2 className="animate-spin" />} Save rule
          </Button>
          <Button variant="ghost" onClick={() => onDone(null)}>
            Cancel
          </Button>
        </div>
      </div>
    </DialogContent>
  );
}
