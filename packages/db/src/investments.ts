import { todayIso } from "@mm/core";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import type { Tx } from "./client";
import { holdings, securities } from "./schema";

export interface IncomingHolding {
  accountId: string;
  security: {
    providerSecurityId: string;
    symbol?: string;
    name: string;
    type?: string;
    currency: string;
    price?: string;
    priceAsOf?: string;
  };
  quantity: string;
  value: number;
  costBasis?: number;
}

const DECIMAL = /^-?\d+(\.\d+)?$/;
const today = todayIso;

/**
 * Replace the holdings of `accountIds` with `incoming` (the provider's full current
 * picture). Securities are upserted per household. Runs inside `withHousehold`.
 */
export async function replaceHoldings(
  tx: Tx,
  householdId: string,
  accountIds: string[],
  incoming: IncomingHolding[],
): Promise<number> {
  const secIds = new Map<string, string>();
  for (const h of incoming) {
    const s = h.security;
    if (secIds.has(s.providerSecurityId)) continue;
    const price = s.price && DECIMAL.test(s.price) ? s.price : null;
    const [row] = await tx
      .insert(securities)
      .values({
        householdId,
        providerSecurityId: s.providerSecurityId,
        symbol: s.symbol ?? null,
        name: s.name,
        type: s.type ?? null,
        currency: s.currency,
        price,
        priceAsOf: s.priceAsOf ?? (price ? today() : null),
      })
      .onConflictDoUpdate({
        target: [securities.householdId, securities.providerSecurityId],
        set: {
          symbol: s.symbol ?? null,
          name: s.name,
          type: s.type ?? null,
          price,
          priceAsOf: s.priceAsOf ?? (price ? today() : null),
        },
      })
      .returning({ id: securities.id });
    secIds.set(s.providerSecurityId, row?.id as string);
  }

  const kept: string[] = [];
  for (const h of incoming) {
    const securityId = secIds.get(h.security.providerSecurityId) as string;
    const quantity = DECIMAL.test(h.quantity) ? h.quantity : "0";
    const [row] = await tx
      .insert(holdings)
      .values({
        householdId,
        accountId: h.accountId,
        securityId,
        quantity,
        value: h.value,
        costBasis: h.costBasis ?? null,
        asOf: today(),
      })
      .onConflictDoUpdate({
        target: [holdings.accountId, holdings.securityId],
        set: { quantity, value: h.value, costBasis: h.costBasis ?? null, asOf: today() },
      })
      .returning({ id: holdings.id });
    if (row) kept.push(row.id);
  }
  if (accountIds.length) {
    await tx
      .delete(holdings)
      .where(
        and(
          inArray(holdings.accountId, accountIds),
          kept.length ? notInArray(holdings.id, kept) : undefined,
        ),
      );
  }
  return kept.length;
}

export async function deleteHolding(tx: Tx, id: string): Promise<void> {
  await tx.delete(holdings).where(eq(holdings.id, id));
}
