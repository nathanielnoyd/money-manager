export const ACCOUNT_TYPES = [
  "depository",
  "credit",
  "loan",
  "investment",
  "property",
  "other",
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** Liability accounts report a positive balance meaning "amount owed". */
export function isLiability(type: AccountType): boolean {
  return type === "credit" || type === "loan";
}

export interface BalanceLike {
  type: AccountType;
  currentBalance: number;
  includeInNetWorth: boolean;
}

/** Net worth in minor units. Assumes a single currency (multi-currency comes later). */
export function netWorth(accounts: readonly BalanceLike[]): number {
  let total = 0;
  for (const a of accounts) {
    if (!a.includeInNetWorth) continue;
    total += isLiability(a.type) ? -a.currentBalance : a.currentBalance;
  }
  return total;
}
