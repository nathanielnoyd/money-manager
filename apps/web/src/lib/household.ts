import "server-only";
import { type Tx, withHousehold } from "@mm/db";
import {
  execute,
  type Operation,
  OperationError,
  type Principal,
  sessionPrincipal,
} from "@mm/services";
import type { z } from "zod";
import { isRecentlyAuthenticated, requireSession, type Session } from "./auth/session";
import { db } from "./db";

/** Run `fn` for the signed-in user's household, under row-level security. */
export async function inHousehold<T>(fn: (tx: Tx, session: Session) => Promise<T>): Promise<T> {
  const s = await requireSession();
  return withHousehold(db(), s.householdId, (tx) => fn(tx, s));
}

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
export type Role = Session["role"];

const RANK: Record<Role, number> = { viewer: 0, member: 1, owner: 2 };
export const hasRole = (s: Pick<Session, "role">, min: Role) => RANK[s.role] >= RANK[min];

const ROLE_ERROR: Record<Role, string> = {
  viewer: "You don't have access to this household.",
  member: "You have view-only access to this household.",
  owner: "Only the household owner can do that.",
};

/**
 * Authorization gate for server actions. Returns an error result to return as-is,
 * or null when the signed-in user's role is sufficient.
 */
export async function denyUnless(min: Role): Promise<ActionResult<never> | null> {
  const s = await requireSession();
  return hasRole(s, min) ? null : { ok: false, error: ROLE_ERROR[min] };
}

/** Server actions that need a recent passkey check return this; the client re-authenticates and retries. */
export const STEP_UP_REQUIRED = "step_up_required";

/** Owner-level role (by default) plus a passkey check within the last 15 minutes. */
export async function requireStepUp(min: Role = "owner"): Promise<Session | ActionResult<never>> {
  const s = await requireSession();
  if (!hasRole(s, min)) return { ok: false, error: ROLE_ERROR[min] };
  return isRecentlyAuthenticated(s) ? s : { ok: false, error: STEP_UP_REQUIRED };
}

/** The signed-in person as an operation principal (every scope; their role still applies). */
export const principalFor = (s: Session): Principal => sessionPrincipal(s);

/**
 * Run a shared operation (@mm/services) as the signed-in person. Expected failures come
 * back as `{ ok: false, error }`; pass `invalidMessage` to replace input-validation errors
 * with wording that suits the form.
 */
export async function runOperation<I extends z.ZodType, O>(
  op: Operation<I, O>,
  input: z.input<I>,
  opts: { invalidMessage?: string } = {},
): Promise<ActionResult<O>> {
  const s = await requireSession();
  try {
    return { ok: true, data: await execute(db(), principalFor(s), op, input) };
  } catch (e) {
    if (e instanceof OperationError) {
      return {
        ok: false,
        error: e.code === "invalid_input" && opts.invalidMessage ? opts.invalidMessage : e.message,
      };
    }
    throw e;
  }
}
