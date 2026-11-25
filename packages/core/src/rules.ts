/**
 * Transaction rules: "when a transaction matches ALL conditions, apply these actions".
 * Rules run in ascending priority; for each field, the first rule that sets it wins,
 * so a specific high-priority rule isn't overridden by a broad later one.
 */

export type RuleField = "description" | "merchant" | "amount" | "direction" | "account";
/**
 * There is deliberately no regex operator: user-supplied regular expressions can backtrack
 * catastrophically and block the server for every household (ReDoS). "contains_any" covers
 * the practical need ("UBER|LYFT|CABIFY"). Legacy "regex" conditions never match.
 */
export type RuleOp =
  | "contains"
  | "contains_any"
  | "equals"
  | "starts_with"
  | "gt"
  | "lt"
  | "between";

export interface RuleCondition {
  field: RuleField;
  op: RuleOp;
  /** Text for text fields; minor units (absolute value) for amount; "in" | "out" for direction; account id. */
  value: string | number;
  value2?: number;
}

export interface RuleActions {
  setCategoryId?: string | null;
  setMerchantName?: string;
  markReviewed?: boolean;
  exclude?: boolean;
}

export interface RuleDef {
  id: string;
  priority: number;
  enabled: boolean;
  conditions: RuleCondition[];
  actions: RuleActions;
}

export interface RuleSubject {
  description: string;
  merchant?: string | null;
  amount: number;
  accountId: string;
}

export interface RuleOutcome extends RuleActions {
  matchedRuleIds: string[];
}

export function conditionMatches(c: RuleCondition, t: RuleSubject): boolean {
  switch (c.field) {
    case "description":
    case "merchant": {
      const hay = (c.field === "description" ? t.description : (t.merchant ?? "")).toLowerCase();
      const needle = String(c.value).toLowerCase();
      if (c.op === "contains") return needle.length > 0 && hay.includes(needle);
      if (c.op === "equals") return hay === needle;
      if (c.op === "starts_with") return needle.length > 0 && hay.startsWith(needle);
      if (c.op === "contains_any") {
        const terms = needle
          .split("|")
          .map((x) => x.trim())
          .filter(Boolean);
        return terms.some((x) => hay.includes(x));
      }
      return false;
    }
    case "amount": {
      const abs = Math.abs(t.amount);
      const v = Number(c.value);
      if (c.op === "equals") return abs === v;
      if (c.op === "gt") return abs > v;
      if (c.op === "lt") return abs < v;
      if (c.op === "between") return abs >= v && abs <= Number(c.value2 ?? v);
      return false;
    }
    case "direction":
      return c.value === "in" ? t.amount > 0 : t.amount < 0;
    case "account":
      return t.accountId === c.value;
  }
}

export function ruleMatches(rule: RuleDef, t: RuleSubject): boolean {
  return (
    rule.enabled &&
    rule.conditions.length > 0 &&
    rule.conditions.every((c) => conditionMatches(c, t))
  );
}

export function applyRules(rules: readonly RuleDef[], t: RuleSubject): RuleOutcome {
  const out: RuleOutcome = { matchedRuleIds: [] };
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);
  for (const rule of sorted) {
    if (!ruleMatches(rule, t)) continue;
    out.matchedRuleIds.push(rule.id);
    const a = rule.actions;
    if (a.setCategoryId !== undefined && out.setCategoryId === undefined)
      out.setCategoryId = a.setCategoryId;
    if (a.setMerchantName && out.setMerchantName === undefined)
      out.setMerchantName = a.setMerchantName;
    if (a.markReviewed !== undefined && out.markReviewed === undefined)
      out.markReviewed = a.markReviewed;
    if (a.exclude !== undefined && out.exclude === undefined) out.exclude = a.exclude;
  }
  return out;
}
