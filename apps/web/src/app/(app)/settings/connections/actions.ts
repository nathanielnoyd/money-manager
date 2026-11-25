"use server";

import { createPlaidLinkToken, parseSetupToken } from "@mm/connectors";
import { seal } from "@mm/crypto";
import { schema, withHousehold } from "@mm/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/auth/audit";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { type ActionResult, denyUnless, inHousehold, requireStepUp } from "@/lib/household";
import { requestSync } from "@/lib/notify";

const allowedHosts = () =>
  process.env.SIMPLEFIN_ALLOWED_HOSTS?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * Link SimpleFIN. The web tier never sees the long-lived access URL: it seals the
 * one-time setup token to the worker's public key, and the worker claims it.
 */
export async function addSimpleFin(token: string): Promise<ActionResult> {
  const s = await requireStepUp();
  if ("ok" in s) return s;
  const parsed = z.string().trim().min(20).max(2000).safeParse(token);
  if (!parsed.success) return { ok: false, error: "Paste the setup token from SimpleFIN Bridge." };
  try {
    parseSetupToken(parsed.data, { allowedHostSuffixes: allowedHosts() });
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const sealed = await seal(parsed.data, env().workerPublicKey);
  const id = await withHousehold(db(), s.householdId, async (tx) => {
    const [c] = await tx
      .insert(schema.connections)
      .values({
        householdId: s.householdId,
        provider: "simplefin",
        institutionName: "SimpleFIN Bridge",
        status: "linking",
        secretSealed: sealed,
        nextSyncAt: new Date(),
      })
      .returning({ id: schema.connections.id });
    await requestSync(tx, s.householdId, c?.id as string);
    return c?.id as string;
  });
  await audit({
    action: "connection.added",
    userId: s.userId,
    householdId: s.householdId,
    detail: { provider: "simplefin", id },
  });
  revalidatePath("/settings/connections");
  return { ok: true };
}

export async function syncNow(connectionId: string): Promise<ActionResult> {
  const denied = await denyUnless("member");
  if (denied) return denied;
  if (!z.uuid().safeParse(connectionId).success)
    return { ok: false, error: "Connection not found." };
  await inHousehold(async (tx, s) => {
    const [c] = await tx
      .update(schema.connections)
      .set({ nextSyncAt: new Date() })
      .where(eq(schema.connections.id, connectionId))
      .returning({ id: schema.connections.id });
    if (c) await requestSync(tx, s.householdId, c.id);
  });
  revalidatePath("/settings/connections");
  return { ok: true };
}

/** Stop syncing and destroy the stored credential. Accounts and history are kept. */
export async function disconnect(connectionId: string): Promise<ActionResult> {
  const s = await requireStepUp();
  if ("ok" in s) return s;
  if (!z.uuid().safeParse(connectionId).success)
    return { ok: false, error: "Connection not found." };
  await withHousehold(db(), s.householdId, (tx) =>
    tx
      .update(schema.connections)
      .set({ status: "disconnected", secretSealed: null, cursor: null, nextSyncAt: null })
      .where(eq(schema.connections.id, connectionId)),
  );
  await audit({
    action: "connection.disconnected",
    userId: s.userId,
    householdId: s.householdId,
    detail: { id: connectionId },
  });
  revalidatePath("/settings/connections");
  return { ok: true };
}

/** Plaid Link token for the browser. The Plaid client secret stays on the server. */
export async function plaidLinkToken(): Promise<ActionResult<{ linkToken: string }>> {
  const cfg = env().plaid;
  if (!cfg) return { ok: false, error: "Plaid isn't configured on this server." };
  const s = await requireStepUp();
  if ("ok" in s) return s;
  try {
    const linkToken = await createPlaidLinkToken(
      { clientId: cfg.clientId, secret: cfg.secret, env: cfg.env },
      s.userId,
      env().rpName,
      cfg.redirectUri,
    );
    return { ok: true, data: { linkToken } };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

const PlaidLink = z.object({
  publicToken: z.string().regex(/^public-[\w-]{10,200}$/),
  institutionName: z.string().trim().max(80).optional(),
});

/**
 * Plaid Link succeeded. Like SimpleFIN, the web tier seals the short-lived public token
 * to the worker, which exchanges it; access tokens never touch the web process.
 */
export async function addPlaid(input: z.input<typeof PlaidLink>): Promise<ActionResult> {
  const s = await requireStepUp();
  if ("ok" in s) return s;
  const p = PlaidLink.safeParse(input);
  if (!p.success) return { ok: false, error: "Plaid returned an unexpected response." };
  const sealed = await seal(JSON.stringify(p.data), env().workerPublicKey);
  await withHousehold(db(), s.householdId, async (tx) => {
    const [c] = await tx
      .insert(schema.connections)
      .values({
        householdId: s.householdId,
        provider: "plaid",
        institutionName: p.data.institutionName || "Plaid",
        status: "linking",
        secretSealed: sealed,
        nextSyncAt: new Date(),
      })
      .returning({ id: schema.connections.id });
    await requestSync(tx, s.householdId, c?.id as string);
  });
  await audit({
    action: "connection.added",
    userId: s.userId,
    householdId: s.householdId,
    detail: { provider: "plaid" },
  });
  revalidatePath("/settings/connections");
  return { ok: true };
}

const TellerLink = z.object({
  accessToken: z.string().regex(/^[\w-]{10,200}$/),
  institutionName: z.string().trim().max(80).optional(),
});

/**
 * Teller Connect returns the access token to the browser; we seal it immediately for
 * the worker so it's never stored or logged in readable form.
 */
export async function addTeller(input: z.input<typeof TellerLink>): Promise<ActionResult> {
  const s = await requireStepUp();
  if ("ok" in s) return s;
  if (!env().teller) return { ok: false, error: "Teller isn't configured on this server." };
  const p = TellerLink.safeParse(input);
  if (!p.success) return { ok: false, error: "Teller returned an unexpected response." };
  const sealed = await seal(JSON.stringify(p.data), env().workerPublicKey);
  await withHousehold(db(), s.householdId, async (tx) => {
    const [c] = await tx
      .insert(schema.connections)
      .values({
        householdId: s.householdId,
        provider: "teller",
        institutionName: p.data.institutionName || "Teller",
        status: "linking",
        secretSealed: sealed,
        nextSyncAt: new Date(),
      })
      .returning({ id: schema.connections.id });
    await requestSync(tx, s.householdId, c?.id as string);
  });
  await audit({
    action: "connection.added",
    userId: s.userId,
    householdId: s.householdId,
    detail: { provider: "teller" },
  });
  revalidatePath("/settings/connections");
  return { ok: true };
}
