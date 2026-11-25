import { applyRulesToExisting, schema } from "@mm/db";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { defineOperation, OperationError } from "../operation";
import { cents, DateStr, Dollars, MonthStr, ownsAll } from "../util";

const write = { minRole: "member", scope: "planning:write", readOnly: false } as const;

// ───────────────────────────── Rules ─────────────────────────────

const Condition = z.discriminatedUnion("field", [
  z.object({
    field: z.enum(["description", "merchant"]),
    op: z.enum(["contains", "contains_any", "equals", "starts_with"]),
    value: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .describe("Case-insensitive; for contains_any, separate alternatives with commas"),
  }),
  z.object({
    field: z.literal("amount"),
    op: z.enum(["equals", "gt", "lt", "between"]),
    value: Dollars.describe("Absolute amount in dollars"),
    value2: Dollars.optional().describe("Upper bound in dollars, for between"),
  }),
  z.object({
    field: z.literal("direction"),
    op: z.literal("equals"),
    value: z.enum(["in", "out"]),
  }),
  z.object({
    field: z.literal("account"),
    op: z.literal("equals"),
    value: z.uuid().describe("Account id from list_accounts"),
  }),
]);

export const RuleInput = z.object({
  id: z.uuid().optional().describe("Omit to create a new rule; pass an id to replace one"),
  name: z.string().trim().min(1).max(80),
  priority: z.number().int().min(0).max(1000).default(50).describe("Higher runs first"),
  enabled: z.boolean().default(true),
  conditions: z.array(Condition).min(1).max(10).describe("All conditions must match"),
  actions: z
    .object({
      setCategoryId: z.uuid().nullable().optional(),
      setMerchantName: z.string().trim().min(1).max(120).optional(),
      markReviewed: z.boolean().optional(),
      exclude: z.boolean().optional(),
    })
    .refine((a) => Object.values(a).some((v) => v !== undefined), "Choose at least one action."),
  applyToExisting: z
    .boolean()
    .default(false)
    .describe("Also apply to existing transactions (user-set categories are kept)"),
});

export const saveRule = defineOperation({
  ...write,
  name: "save_rule",
  title: "Create or update rule",
  description:
    "Create (no id) or replace (with id) a rule that categorizes, renames, marks reviewed or excludes matching transactions as they arrive. Optionally applies it to existing transactions; returns how many changed.",
  input: RuleInput,
  async run(tx, p, input) {
    const { id, applyToExisting, ...rule } = input;
    const conditions = rule.conditions.map((c) =>
      c.field === "amount"
        ? {
            ...c,
            value: cents(c.value),
            ...(c.value2 != null ? { value2: cents(c.value2) } : {}),
          }
        : c,
    );
    const accountIds = rule.conditions.flatMap((c) => (c.field === "account" ? [c.value] : []));
    if (
      !(await ownsAll(tx, "categories", [rule.actions.setCategoryId])) ||
      !(await ownsAll(tx, "accounts", accountIds))
    )
      throw new OperationError("not_found", "That category or account doesn't exist.");
    let ruleId = id;
    const values = { ...rule, conditions };
    if (id) {
      const r = await tx
        .update(schema.rules)
        .set(values)
        .where(eq(schema.rules.id, id))
        .returning({ id: schema.rules.id });
      if (!r.length) throw new OperationError("not_found", "Rule not found.");
    } else {
      const [r] = await tx
        .insert(schema.rules)
        .values({ ...values, householdId: p.householdId })
        .returning({ id: schema.rules.id });
      ruleId = r?.id;
    }
    const applied = applyToExisting && ruleId ? await applyRulesToExisting(tx, { ruleId }) : 0;
    return { id: ruleId as string, applied };
  },
});

export const applyRules = defineOperation({
  ...write,
  name: "apply_rules",
  title: "Apply rules to existing transactions",
  description:
    "Run every enabled rule (or just one, by id) over existing transactions. Categories a person set by hand are kept. Returns how many transactions changed.",
  idempotent: true,
  input: z.object({ ruleId: z.uuid().optional() }),
  async run(tx, _p, { ruleId }) {
    return { applied: await applyRulesToExisting(tx, ruleId ? { ruleId } : undefined) };
  },
});

// ───────────────────────────── Budgets ─────────────────────────────

export const setBudget = defineOperation({
  ...write,
  name: "set_budget",
  title: "Set budget",
  description:
    "Set the budget for one category in one month, in dollars. 0 removes the budget line.",
  idempotent: true,
  input: z.object({
    categoryId: z.uuid(),
    month: MonthStr,
    amount: Dollars.describe("Dollars"),
  }),
  async run(tx, p, { categoryId, month, amount }) {
    if (!(await ownsAll(tx, "categories", [categoryId])))
      throw new OperationError("not_found", "That category doesn't exist.");
    const minor = cents(amount);
    if (minor === 0) {
      await tx
        .delete(schema.budgetItems)
        .where(
          and(eq(schema.budgetItems.categoryId, categoryId), eq(schema.budgetItems.month, month)),
        );
    } else {
      await tx
        .insert(schema.budgetItems)
        .values({ householdId: p.householdId, categoryId, month, amount: minor })
        .onConflictDoUpdate({
          target: [schema.budgetItems.categoryId, schema.budgetItems.month],
          set: { amount: minor },
        });
    }
    return { categoryId, month, amount };
  },
});

// ───────────────────────────── Goals ─────────────────────────────

export const saveGoal = defineOperation({
  ...write,
  name: "save_goal",
  title: "Create or update goal",
  description:
    "Create (no id) or replace (with id) a savings goal. Progress comes from the linked accounts' balances, or from `manualAmount` when no accounts are linked. Amounts in dollars.",
  input: z.object({
    id: z.uuid().optional(),
    name: z.string().trim().min(1).max(80),
    targetAmount: Dollars.refine((n) => n > 0, "Must be more than 0").describe("Dollars"),
    targetDate: DateStr.nullable().default(null),
    accountIds: z.array(z.uuid()).max(20).default([]),
    manualAmount: Dollars.default(0).describe("Dollars; used when no accounts are linked"),
  }),
  async run(tx, p, { id, ...g }) {
    if (!(await ownsAll(tx, "accounts", g.accountIds)))
      throw new OperationError("not_found", "One of those accounts doesn't exist.");
    const values = {
      ...g,
      targetAmount: cents(g.targetAmount),
      manualAmount: cents(g.manualAmount),
    };
    if (id) {
      const r = await tx
        .update(schema.goals)
        .set(values)
        .where(eq(schema.goals.id, id))
        .returning({ id: schema.goals.id });
      if (!r.length) throw new OperationError("not_found", "Goal not found.");
      return { id };
    }
    const [r] = await tx
      .insert(schema.goals)
      .values({ ...values, householdId: p.householdId })
      .returning({ id: schema.goals.id });
    return { id: r?.id as string };
  },
});

// ───────────────────────────── Categories ─────────────────────────────

export const createCategory = defineOperation({
  ...write,
  name: "create_category",
  title: "Create category",
  description:
    "Add a category to an existing group (group id from list_categories). Names are unique within the household.",
  input: z.object({ groupId: z.uuid(), name: z.string().trim().min(1).max(60) }),
  async run(tx, p, { groupId, name }) {
    if (!(await ownsAll(tx, "categoryGroups", [groupId])))
      throw new OperationError("not_found", "That category group doesn't exist.");
    const [existing] = await tx
      .select({ id: schema.categories.id })
      .from(schema.categories)
      .where(sql`lower(${schema.categories.name}) = lower(${name})`);
    if (existing) throw new OperationError("conflict", "A category with that name already exists.");
    const { rows } = await tx.execute<{ n: number }>(
      sql`select coalesce(max(sort_order), 0) + 1 as n from categories where group_id = ${groupId}`,
    );
    const [c] = await tx
      .insert(schema.categories)
      .values({ householdId: p.householdId, groupId, name, sortOrder: Number(rows[0]?.n ?? 0) })
      .returning({ id: schema.categories.id });
    return { id: c?.id as string, name };
  },
});

export const PLANNING_OPERATIONS = [
  saveRule,
  applyRules,
  setBudget,
  saveGoal,
  createCategory,
] as const;
