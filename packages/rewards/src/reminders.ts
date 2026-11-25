import { REWARD_CATEGORIES, type RewardCategory } from "./categories";

/**
 * Card rewards reminders. Pure: the worker gathers facts, this decides what to say. Every
 * reminder has a stable key so it is sent at most once (see notification_log).
 */

export interface ReminderCard {
  walletCardId: string;
  name: string;
  account: string;
  rotating?: { quarter: string; categories: RewardCategory[]; activated: boolean };
  caps: {
    ruleIndex: number;
    label: string;
    periodKey: string;
    spentCents: number;
    capCents: number;
  }[];
  bonus?: { points: number; minSpendCents: number; spentCents: number; deadline: string };
  fee?: { annualFeeCents: number; nextFeeDate: string; netValueCents?: number };
}

export interface ReminderFacts {
  today: string;
  cards: ReminderCard[];
  /** Catalog cards in the wallet whose data is older than this many days get a stale notice. */
  stale: { slug: string; name: string; verifiedAt: string }[];
  includeAmounts: boolean;
}

export interface Reminder {
  kind: "rewards";
  key: string;
  title: string;
  body: string;
  priority: "default" | "high";
}

const days = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const usd = (cents: number) =>
  (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

export function rewardReminders(f: ReminderFacts): Reminder[] {
  const out: Reminder[] = [];
  const amt = (cents: number, fallback: string) => (f.includeAmounts ? usd(cents) : fallback);
  for (const c of f.cards) {
    const r = c.rotating;
    if (r?.categories.length && !r.activated) {
      const cats = r.categories.map((x) => REWARD_CATEGORIES[x].label.toLowerCase()).join(", ");
      out.push({
        kind: "rewards",
        key: `activate:${c.walletCardId}:${r.quarter}`,
        title: `Activate ${c.name} bonus categories`,
        body: `${r.quarter}: ${cats}. Activate with your card issuer, then tick it on the Rewards page.`,
        priority: "default",
      });
    }
    for (const cap of c.caps) {
      if (cap.capCents <= 0 || cap.spentCents < cap.capCents * 0.9) continue;
      const full = cap.spentCents >= cap.capCents;
      out.push({
        kind: "rewards",
        key: `cap:${c.walletCardId}:${cap.ruleIndex}:${cap.periodKey}`,
        title: full ? `${c.name}: bonus cap reached` : `${c.name}: bonus cap almost reached`,
        body: full
          ? `${cap.label} now earns the base rate until the cap resets. Check Rewards for a better card.`
          : `${amt(cap.spentCents, "Most")} of ${amt(cap.capCents, "the cap")} used on ${cap.label}.`,
        priority: "default",
      });
    }
    const b = c.bonus;
    if (b) {
      const left = days(f.today, b.deadline);
      const remaining = b.minSpendCents - b.spentCents;
      if (remaining <= 0 && left >= -30) {
        out.push({
          kind: "rewards",
          key: `bonus-met:${c.walletCardId}:${b.deadline}`,
          title: `${c.name}: sign-up bonus spend reached`,
          body: `You've met the spending for ${b.points.toLocaleString("en-US")} bonus points.`,
          priority: "default",
        });
      } else if (remaining > 0 && left >= 0) {
        for (const threshold of [7, 30]) {
          if (left > threshold) continue;
          out.push({
            kind: "rewards",
            key: `bonus:${c.walletCardId}:${b.deadline}:${threshold}`,
            title: `${c.name}: ${left} day${left === 1 ? "" : "s"} left for the sign-up bonus`,
            body: `Spend ${amt(remaining, "a bit more")} more by ${b.deadline} to earn ${b.points.toLocaleString("en-US")} points.`,
            priority: threshold === 7 ? "high" : "default",
          });
          break;
        }
      }
    }
    const fee = c.fee;
    if (fee && fee.annualFeeCents > 0) {
      const left = days(f.today, fee.nextFeeDate);
      if (left >= 0 && left <= 30) {
        const verdict =
          fee.netValueCents === undefined
            ? "See Rewards for what it earned you this year."
            : fee.netValueCents >= 0
              ? `It earned you ${amt(fee.netValueCents, "more than")} more than its fee over the last year.`
              : `It earned ${amt(-fee.netValueCents, "less")} less than its fee over the last year. Consider a downgrade.`;
        out.push({
          kind: "rewards",
          key: `fee:${c.walletCardId}:${fee.nextFeeDate}`,
          title: `${c.name}: ${amt(fee.annualFeeCents, "annual")} fee due ${fee.nextFeeDate}`,
          body: verdict,
          priority: "default",
        });
      }
    }
  }
  for (const s of f.stale) {
    out.push({
      kind: "rewards",
      key: `stale:${s.slug}:${s.verifiedAt}`,
      title: `${s.name}: card details may be out of date`,
      body: `Its rates were last checked on ${s.verifiedAt}. Update Money Manager, or ask your agent to check the card.`,
      priority: "default",
    });
  }
  return out;
}

/** The next anniversary of `openedOn` on or after `today` (annual fees post around then). */
export function nextAnniversary(openedOn: string, today: string): string {
  const year = Number(today.slice(0, 4));
  const md = openedOn.slice(5);
  // Feb 29 openings fall back to Feb 28 in non-leap years.
  const leap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const at = (y: number) => (md === "02-29" && !leap(y) ? `${y}-02-28` : `${y}-${md}`);
  const candidate = at(year);
  return candidate >= today ? candidate : at(year + 1);
}
