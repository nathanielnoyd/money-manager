import { createHash, randomBytes } from "node:crypto";
import { type Db, schema, type Tx, withHousehold } from "@mm/db";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  lowerRole,
  OperationError,
  type Principal,
  type Role,
  SCOPES,
  type Scope,
} from "./operation";

/**
 * Agent tokens: long-lived bearer tokens for the MCP server. Only a SHA-256 hash is
 * stored. A token acts as its creator, capped at `maxRole` and limited to its scopes, and
 * stops working the moment the creator leaves the household, is demoted below what the
 * token needs, the token expires, or it is revoked.
 */

export const TOKEN_PREFIX = "mm_pat_";
const TOKEN_RE = /^mm_pat_[A-Za-z0-9_-]{43}$/;
export const MAX_TOKENS_PER_USER = 20;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export const CreateTokenInput = z.object({
  name: z.string().trim().min(1).max(60),
  scopes: z
    .array(z.enum(SCOPES))
    .min(1)
    .max(SCOPES.length)
    .transform((s) => [...new Set<Scope>(["read", ...s])]),
  maxRole: z.enum(["owner", "member", "viewer"]).default("member"),
  expiresInDays: z.union([z.literal(7), z.literal(30), z.literal(90), z.literal(365)]).default(90),
});

export async function createApiToken(
  tx: Tx,
  creator: { userId: string; householdId: string; role: Role },
  raw: z.input<typeof CreateTokenInput>,
): Promise<{ id: string; token: string; expiresAt: Date }> {
  const p = CreateTokenInput.safeParse(raw);
  if (!p.success) throw new OperationError("invalid_input", "Give the token a name and a scope.");
  const { rows } = await tx.execute<{ n: number }>(
    sql`select count(*)::int as n from api_tokens where user_id = ${creator.userId} and revoked_at is null and expires_at > now()`,
  );
  if ((rows[0]?.n ?? 0) >= MAX_TOKENS_PER_USER)
    throw new OperationError("conflict", "You have too many active tokens. Revoke one first.");
  // Never more than the creator has, and never write scopes on a read-only token.
  const maxRole = lowerRole(p.data.maxRole, creator.role);
  const scopes = maxRole === "viewer" ? (["read"] as Scope[]) : p.data.scopes;
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  const expiresAt = new Date(Date.now() + p.data.expiresInDays * 86_400_000);
  const [row] = await tx
    .insert(schema.apiTokens)
    .values({
      householdId: creator.householdId,
      userId: creator.userId,
      name: p.data.name,
      tokenHash: hash(token),
      prefix: token.slice(0, TOKEN_PREFIX.length + 6),
      scopes,
      maxRole,
      expiresAt,
    })
    .returning({ id: schema.apiTokens.id });
  return { id: row?.id as string, token, expiresAt };
}

/** Tokens visible to this person: the owner sees every member's, others only their own. */
export async function listApiTokens(tx: Tx, viewer: { userId: string; role: Role }) {
  const t = schema.apiTokens;
  return tx
    .select({
      id: t.id,
      name: t.name,
      prefix: t.prefix,
      scopes: t.scopes,
      maxRole: t.maxRole,
      expiresAt: t.expiresAt,
      lastUsedAt: t.lastUsedAt,
      lastUsedIp: t.lastUsedIp,
      createdAt: t.createdAt,
      userId: t.userId,
      createdBy: schema.users.displayName,
    })
    .from(t)
    .innerJoin(schema.users, eq(schema.users.id, t.userId))
    .where(
      and(
        isNull(t.revokedAt),
        sql`${t.expiresAt} > now()`,
        viewer.role === "owner" ? undefined : eq(t.userId, viewer.userId),
      ),
    )
    .orderBy(desc(t.createdAt));
}

/** Revoke one token. Owners can revoke anyone's; others only their own. */
export async function revokeApiToken(
  tx: Tx,
  viewer: { userId: string; role: Role },
  id: string,
): Promise<boolean> {
  const t = schema.apiTokens;
  const r = await tx
    .update(t)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(t.id, id),
        isNull(t.revokedAt),
        viewer.role === "owner" ? undefined : eq(t.userId, viewer.userId),
      ),
    )
    .returning({ id: t.id });
  return r.length > 0;
}

type TokenRow = {
  id: string;
  household_id: string;
  user_id: string;
  scopes: string[];
  max_role: Role;
  expires_at: Date;
  revoked_at: Date | null;
  last_used_at: Date | null;
};

/**
 * Resolve a bearer token to a principal, or null. The lookup happens before any household
 * scope exists, so it goes through `find_api_token()`, a SECURITY DEFINER function that
 * returns at most the one row whose hash matches. Membership is re-checked every time.
 */
export async function authenticateToken(
  db: Db,
  token: string,
  meta: { ip?: string } = {},
): Promise<Principal | null> {
  if (!TOKEN_RE.test(token)) return null;
  const { rows } = await db.execute<TokenRow>(sql`select * from find_api_token(${hash(token)})`);
  const row = rows[0];
  if (!row || row.revoked_at || new Date(row.expires_at).getTime() <= Date.now()) return null;
  const [member] = await db
    .select({ role: schema.householdMembers.role })
    .from(schema.householdMembers)
    .where(
      and(
        eq(schema.householdMembers.userId, row.user_id),
        eq(schema.householdMembers.householdId, row.household_id),
      ),
    );
  if (!member) return null;
  const role = lowerRole(row.max_role, member.role);
  const scopes = (role === "viewer" ? ["read"] : row.scopes).filter((s): s is Scope =>
    (SCOPES as readonly string[]).includes(s),
  );
  // Record use at most once a minute to keep writes off the hot path.
  const last = row.last_used_at ? new Date(row.last_used_at).getTime() : 0;
  if (Date.now() - last > 60_000) {
    await withHousehold(db, row.household_id, (tx) =>
      tx
        .update(schema.apiTokens)
        .set({ lastUsedAt: new Date(), lastUsedIp: meta.ip?.slice(0, 64) ?? null })
        .where(eq(schema.apiTokens.id, row.id)),
    );
  }
  return {
    userId: row.user_id,
    householdId: row.household_id,
    role,
    via: "token",
    tokenId: row.id,
    scopes,
  };
}
