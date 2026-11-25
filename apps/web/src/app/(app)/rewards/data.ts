import "server-only";
import { execute, getWallet, householdCatalog, rateSummary } from "@mm/services";
import { requireSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { hasRole, inHousehold, principalFor } from "@/lib/household";

/** Shared by the Rewards tabs: the caller as a principal, edit rights, and the wallet. */
export async function rewardsContext() {
  const s = await requireSession();
  const p = principalFor(s);
  const wallet = await execute(db(), p, getWallet, {});
  return {
    p,
    canEdit: hasRole(s, "member"),
    wallet,
    hasCredit: wallet.cards.length + wallet.unlinkedCreditAccounts.length > 0,
  };
}

/** Cards to choose from: the household's catalog, including its own custom cards. */
export const catalogOptions = async () =>
  (await inHousehold((tx) => householdCatalog(tx))).cards
    .map((c) => ({
      slug: c.slug,
      label: c.name,
      issuer: c.issuer,
      rates: rateSummary(c),
      rotating: !!c.rotating,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
