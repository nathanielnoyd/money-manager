import { type Alert, addDays } from "@mm/core";
import type { Tx } from "@mm/db";
import {
  capUsage,
  marginalValues,
  nextAnniversary,
  quarterOf,
  REWARD_CATEGORIES,
  type ReminderCard,
  rewardReminders,
} from "@mm/rewards";
import {
  bonusProgress,
  centsPerPoint,
  householdCatalog,
  householdRewardsSettings,
  loadCardSpend,
  loadWallet,
} from "@mm/services";

/** Catalog data older than this triggers a one-time "may be out of date" notice. */
const STALE_DAYS = 180;

/**
 * Facts for card rewards reminders, gathered inside the household's RLS transaction. The
 * decisions themselves are pure (@mm/rewards reminders.ts).
 */
export async function rewardAlerts(
  tx: Tx,
  today: string,
  includeAmounts: boolean,
): Promise<Alert[]> {
  const wallet = await loadWallet(tx);
  if (!wallet.length) return [];
  const [settings, catalog] = await Promise.all([
    householdRewardsSettings(tx),
    householdCatalog(tx),
  ]);
  const bonusStarts = wallet.flatMap((w) =>
    w.signupBonus
      ? [w.signupBonus.startDate ?? w.openedOn ?? addDays(w.signupBonus.deadline, -120)]
      : [],
  );
  const start = [`${Number(today.slice(0, 4)) - 1}-01-01`, ...bonusStarts].sort()[0] as string;
  const txns = await loadCardSpend(tx, { start, end: today }, wallet);
  const quarter = quarterOf(today);

  // Net value only matters for cards whose fee is due soon; computing it replays a year.
  const feeSoon = wallet.filter(
    (w) =>
      w.card.annualFee > 0 &&
      w.openedOn &&
      nextAnniversary(w.openedOn, today) <= addDays(today, 30),
  );
  const yearAgo = addDays(today, -364);
  const marginal = feeSoon.length
    ? marginalValues(
        wallet,
        txns.filter((t) => t.date >= yearAgo),
        (p) => centsPerPoint(settings, p, catalog),
      )
    : new Map<string, number>();

  const cards: ReminderCard[] = wallet.map((w) => {
    const rotating = w.card.rotating
      ? {
          quarter,
          categories: w.card.rotating[quarter] ?? [],
          activated: !!w.activations?.includes(quarter),
        }
      : undefined;
    const caps = capUsage(w, txns, today).map((u) => ({
      ruleIndex: u.ruleIndex,
      periodKey: u.periodKey,
      spentCents: u.spentCents,
      capCents: u.capCents,
      label: u.rule.merchants?.length
        ? (u.rule.merchants[0] ?? "").toLowerCase()
        : u.rule.categories.map((c) => REWARD_CATEGORIES[c].label.toLowerCase()).join(", ") ||
          "bonus categories",
    }));
    const bonus = w.signupBonus
      ? (() => {
          const p = bonusProgress(w, txns, today);
          return {
            points: p.points,
            minSpendCents: Math.round(p.minSpend * 100),
            spentCents: p.spentCents,
            deadline: p.deadline,
          };
        })()
      : undefined;
    const fee =
      w.card.annualFee > 0 && w.openedOn
        ? {
            annualFeeCents: Math.round(w.card.annualFee * 100),
            nextFeeDate: nextAnniversary(w.openedOn, today),
            ...(marginal.has(w.id)
              ? {
                  netValueCents:
                    (marginal.get(w.id) ?? 0) + w.creditsValue - Math.round(w.card.annualFee * 100),
                }
              : {}),
          }
        : undefined;
    return {
      walletCardId: w.id,
      name: w.card.name,
      account: w.accountName,
      caps,
      ...(rotating ? { rotating } : {}),
      ...(bonus ? { bonus } : {}),
      ...(fee ? { fee } : {}),
    };
  });
  const staleBefore = addDays(today, -STALE_DAYS);
  const stale = [...new Map(wallet.map((w) => [w.card.slug, w.card])).values()]
    .filter((c) => c.verifiedAt < staleBefore)
    .map((c) => ({ slug: c.slug, name: c.name, verifiedAt: c.verifiedAt }));
  return rewardReminders({ today, cards, stale, includeAmounts });
}
