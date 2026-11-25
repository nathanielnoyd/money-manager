import "server-only";
import type { FinanceTools } from "@mm/ai";
import {
  accountBalances,
  budgetStatus,
  execute,
  monthlyTotals,
  netWorthHistory,
  type Operation,
  type Principal,
  recurringCharges,
  searchTransactions,
  spendingByCategory,
  spendingByMerchant,
} from "@mm/services";
import { db } from "./db";

/**
 * Ask's read-only tools, backed by the shared operations in @mm/services (the same code
 * the MCP server exposes). Each call validates its input and runs in its own short
 * transaction scoped to the household (row-level security). Amounts are dollars.
 */
export function financeToolsFor(principal: Principal): FinanceTools {
  const run = (op: Operation) => (input: unknown) => execute(db(), principal, op, input);
  return {
    spendingByCategory: run(spendingByCategory as Operation),
    spendingByMerchant: run(spendingByMerchant as Operation),
    monthlyTotals: run(monthlyTotals as Operation),
    searchTransactions: run(searchTransactions as Operation),
    accountBalances: () => run(accountBalances as Operation)({}),
    budgetStatus: run(budgetStatus as Operation),
    recurringCharges: () => run(recurringCharges as Operation)({}),
    netWorthHistory: run(netWorthHistory as Operation),
  };
}
