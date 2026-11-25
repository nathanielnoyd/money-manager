"use server";

import { todayIso } from "@mm/core";
import { deleteHolding, schema } from "@mm/db";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, denyUnless, inHousehold } from "@/lib/household";

const Holding = z.object({
  accountId: z.uuid(),
  symbol: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9.-]{1,12}$/),
  name: z.string().trim().min(1).max(120),
  type: z.enum(["equity", "etf", "mutual fund", "fixed income", "cash", "cryptocurrency", "other"]),
  quantity: z.string().regex(/^\d+(\.\d{1,8})?$/),
  value: z.number().int().min(0),
  costBasis: z.number().int().min(0).nullable(),
});

/** For manual investment accounts: holdings you enter yourself. The account balance follows their total. */
async function syncManualBalance(
  tx: Parameters<Parameters<typeof inHousehold>[0]>[0],
  householdId: string,
  accountId: string,
) {
  const { rows } = await tx.execute<{ total: string | null }>(
    sql`select sum(value) as total from holdings where account_id = ${accountId}`,
  );
  const total = Number(rows[0]?.total ?? 0);
  await tx
    .update(schema.accounts)
    .set({ currentBalance: total, balanceUpdatedAt: new Date() })
    .where(eq(schema.accounts.id, accountId));
  const today = todayIso();
  await tx
    .insert(schema.balanceSnapshots)
    .values({ householdId, accountId, date: today, balance: total })
    .onConflictDoUpdate({
      target: [schema.balanceSnapshots.accountId, schema.balanceSnapshots.date],
      set: { balance: total },
    });
}

export async function saveManualHolding(input: z.input<typeof Holding>): Promise<ActionResult> {
  const denied = await denyUnless("member");
  if (denied) return denied;
  const p = Holding.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Check the holding." };
  const h = p.data;
  const err = await inHousehold(async (tx, s) => {
    const [acct] = await tx
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.id, h.accountId));
    if (acct?.type !== "investment" || acct.connectionId)
      return "Holdings can only be edited on manual investment accounts.";
    const qty = Number(h.quantity);
    const price = qty > 0 ? (h.value / 100 / qty).toFixed(6) : null;
    const [sec] = await tx
      .insert(schema.securities)
      .values({
        householdId: s.householdId,
        providerSecurityId: `manual:${h.symbol}`,
        symbol: h.symbol,
        name: h.name,
        type: h.type,
        price,
        priceAsOf: todayIso(),
      })
      .onConflictDoUpdate({
        target: [schema.securities.householdId, schema.securities.providerSecurityId],
        set: { name: h.name, type: h.type, price },
      })
      .returning({ id: schema.securities.id });
    await tx
      .insert(schema.holdings)
      .values({
        householdId: s.householdId,
        accountId: h.accountId,
        securityId: sec?.id as string,
        quantity: h.quantity,
        value: h.value,
        costBasis: h.costBasis,
        asOf: todayIso(),
      })
      .onConflictDoUpdate({
        target: [schema.holdings.accountId, schema.holdings.securityId],
        set: { quantity: h.quantity, value: h.value, costBasis: h.costBasis },
      });
    await syncManualBalance(tx, s.householdId, h.accountId);
    return null;
  });
  if (err) return { ok: false, error: err };
  revalidatePath("/investments");
  revalidatePath("/accounts");
  return { ok: true };
}

export async function removeManualHolding(id: string): Promise<ActionResult> {
  const denied = await denyUnless("member");
  if (denied) return denied;
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "Invalid holding." };
  const err = await inHousehold(async (tx, s) => {
    const [row] = await tx
      .select({ accountId: schema.holdings.accountId, connectionId: schema.accounts.connectionId })
      .from(schema.holdings)
      .innerJoin(schema.accounts, eq(schema.accounts.id, schema.holdings.accountId))
      .where(and(eq(schema.holdings.id, id)));
    if (!row) return "Holding not found.";
    if (row.connectionId) return "This holding comes from your brokerage.";
    await deleteHolding(tx, id);
    await syncManualBalance(tx, s.householdId, row.accountId);
    return null;
  });
  if (err) return { ok: false, error: err };
  revalidatePath("/investments");
  return { ok: true };
}
