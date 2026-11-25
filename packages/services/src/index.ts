import type { Operation } from "./operation";
import { CATALOG_OPERATIONS } from "./operations/catalog";
import { OPTIMIZE_OPERATIONS } from "./operations/optimize";
import { PLANNING_OPERATIONS } from "./operations/planning";
import { READ_OPERATIONS } from "./operations/reads";
import { REWARDS_OPERATIONS } from "./operations/rewards";
import { TRANSACTION_OPERATIONS } from "./operations/transactions";

export * from "./catalog";
export * from "./export";
export * from "./operation";
export * from "./operations/catalog";
export * from "./operations/optimize";
export * from "./operations/planning";
export * from "./operations/reads";
export * from "./operations/rewards";
export * from "./operations/transactions";
export * from "./rewards";
export * from "./tokens";
export { cents, dollars, ownsAll } from "./util";

/**
 * Every operation the app exposes to the UI, Ask and agents. To add a capability, define
 * an operation (see docs/customizing.md) and add it to one of these lists: it becomes an
 * MCP tool automatically, gated by its role and scope.
 */
export const OPERATIONS: readonly Operation[] = [
  ...READ_OPERATIONS,
  ...TRANSACTION_OPERATIONS,
  ...PLANNING_OPERATIONS,
  ...REWARDS_OPERATIONS,
  ...OPTIMIZE_OPERATIONS,
  ...CATALOG_OPERATIONS,
] as unknown as readonly Operation[];

const BY_NAME = new Map(OPERATIONS.map((op) => [op.name, op]));
if (BY_NAME.size !== OPERATIONS.length) throw new Error("Duplicate operation name");

export const findOperation = (name: string): Operation | undefined => BY_NAME.get(name);
