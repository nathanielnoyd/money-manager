import { type Executor, schema, type Tx, withHousehold } from "@mm/db";
import type { z } from "zod";

/**
 * Operations are the app's single description of "something a caller can do with a
 * household's data". The web UI (server actions), Ask, and the MCP server all call the
 * same operations, so validation, authorization and row-level security live in one place.
 *
 * Money in operation inputs and outputs is in **dollars** (major units) so that agents and
 * the AI see one convention everywhere; operations convert to cents before touching the
 * database.
 */

export type Role = "owner" | "member" | "viewer";

export const SCOPES = [
  "read",
  "transactions:write",
  "planning:write",
  "rewards:write",
  "rewards:catalog",
] as const;
export type Scope = (typeof SCOPES)[number];

export const SCOPE_INFO: Record<Scope, { label: string; description: string }> = {
  read: {
    label: "Read",
    description: "Balances, transactions, budgets, goals, rules and reports.",
  },
  "transactions:write": {
    label: "Edit transactions",
    description: "Categorize, rename merchants, add notes, mark reviewed or excluded.",
  },
  "planning:write": {
    label: "Edit planning",
    description: "Rules, budgets, goals and categories.",
  },
  "rewards:write": {
    label: "Edit card rewards",
    description: "Wallet cards, reward categories and point values.",
  },
  "rewards:catalog": {
    label: "Edit card catalog",
    description:
      "Earn rates, fees and point values for this household's catalog, with sources. Every change is kept in history and can be undone.",
  },
};

/** Who is calling. Built from a browser session or from an agent token. */
export interface Principal {
  userId: string;
  householdId: string;
  role: Role;
  /** "worker": the background worker acting for the household (e.g. the catalog refresher). */
  via: "session" | "token" | "worker";
  /** Set when `via` is "token"; recorded in the audit log for every write. */
  tokenId?: string;
  scopes: readonly Scope[];
}

export interface Operation<I extends z.ZodType = z.ZodType, O = unknown> {
  /** snake_case; also the MCP tool name. */
  name: string;
  title: string;
  /** Written for an agent: what it does, when to use it, units. */
  description: string;
  input: I;
  minRole: Role;
  scope: Scope;
  readOnly: boolean;
  /** Deletes or overwrites data in a way that can't be undone from the result. */
  destructive?: boolean;
  /** Calling twice with the same input has the same effect as calling once. */
  idempotent?: boolean;
  /**
   * Only a person signed in to the app may call it, never an agent token or the worker:
   * approving agent proposals, and the setting that requires approval.
   */
  sessionOnly?: boolean;
  run(tx: Tx, principal: Principal, input: z.output<I>): Promise<O>;
}

export const defineOperation = <I extends z.ZodType, O>(op: Operation<I, O>): Operation<I, O> => op;

export type OperationErrorCode = "forbidden" | "invalid_input" | "not_found" | "conflict";

/** An expected failure whose message is safe to show to a person or an agent. */
export class OperationError extends Error {
  constructor(
    public code: OperationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "OperationError";
  }
}

const RANK: Record<Role, number> = { viewer: 0, member: 1, owner: 2 };
export const hasRole = (role: Role, min: Role) => RANK[role] >= RANK[min];
export const lowerRole = (a: Role, b: Role): Role => (RANK[a] <= RANK[b] ? a : b);

const ROLE_ERROR: Record<Role, string> = {
  viewer: "You don't have access to this household.",
  member: "You have view-only access to this household.",
  owner: "Only the household owner can do that.",
};

/** True when the principal may call the operation (role and scope); doesn't check input. */
export const allows = (p: Principal, op: Operation) =>
  hasRole(p.role, op.minRole) &&
  p.scopes.includes(op.scope) &&
  (!op.sessionOnly || p.via === "session");

function describeIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid input.";
  const path = issue.path.length ? `${issue.path.join(".")}: ` : "";
  return `${path}${issue.message}`;
}

/**
 * Check role and scope, validate the input, and run the operation inside one transaction
 * scoped to the principal's household (row-level security). Writes made with an agent
 * token are recorded in the audit log in the same transaction.
 */
export async function execute<I extends z.ZodType, O>(
  db: Executor,
  principal: Principal,
  op: Operation<I, O>,
  rawInput: unknown,
): Promise<O> {
  if (!hasRole(principal.role, op.minRole)) {
    throw new OperationError("forbidden", ROLE_ERROR[op.minRole]);
  }
  if (!principal.scopes.includes(op.scope)) {
    throw new OperationError("forbidden", `This token doesn't have the "${op.scope}" scope.`);
  }
  if (op.sessionOnly && principal.via !== "session") {
    throw new OperationError("forbidden", "Only a person signed in to the app can do that.");
  }
  const parsed = op.input.safeParse(rawInput ?? {});
  if (!parsed.success) throw new OperationError("invalid_input", describeIssue(parsed.error));
  return withHousehold(db, principal.householdId, async (tx) => {
    const out = await op.run(tx, principal, parsed.data);
    if (!op.readOnly && principal.via !== "session") {
      await tx.insert(schema.auditLog).values({
        householdId: principal.householdId,
        userId: principal.userId,
        action: principal.via === "token" ? "agent.write" : "worker.write",
        detail: { operation: op.name, tokenId: principal.tokenId },
      });
    }
    return out;
  });
}

/** A signed-in person in the browser has every scope; their role still applies. */
export const sessionPrincipal = (s: {
  userId: string;
  householdId: string;
  role: Role;
}): Principal => ({
  userId: s.userId,
  householdId: s.householdId,
  role: s.role,
  via: "session",
  scopes: SCOPES,
});

/**
 * The worker acting for a household, as the owner who turned the feature on. It can read
 * and edit the catalog, nothing else, and its edits follow the household's approval setting.
 */
export const workerPrincipal = (s: { userId: string; householdId: string }): Principal => ({
  userId: s.userId,
  householdId: s.householdId,
  role: "member",
  via: "worker",
  scopes: ["read", "rewards:catalog"],
});
