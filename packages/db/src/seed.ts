import { toMinor } from "@mm/core";
import { eq } from "drizzle-orm";
import type { Db, Tx } from "./client";
import { withHousehold } from "./client";
import { replaceHoldings } from "./investments";
import { accounts, balanceSnapshots, categories, merchants, transactions } from "./schema";

/**
 * Deterministic generator of a realistic household: a year of paychecks, bills,
 * subscriptions, card spending, savings transfers and investment growth, with
 * daily balance snapshots that reconcile with the transactions.
 * Used for local development, tests, and the public demo. Contains no real data.
 */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type AccountKey =
  | "checking"
  | "savings"
  | "card"
  | "brokerage"
  | "retirement"
  | "mortgage"
  | "home";

interface GenTxn {
  account: AccountKey;
  date: string;
  amount: number; // minor units, + in / - out
  raw: string;
  merchant: string;
  category: string;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

export interface SeedOptions {
  months?: number;
  seed?: number;
  today?: Date;
}

export async function seedDemoData(db: Db, householdId: string, opts: SeedOptions = {}) {
  const rand = mulberry32(opts.seed ?? 42);
  const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
  const money = (lo: number, hi: number) => toMinor(between(lo, hi));
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;

  const today = new Date(opts.today ?? Date.now());
  today.setUTCHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setUTCMonth(start.getUTCMonth() - (opts.months ?? 12));

  const txns: GenTxn[] = [];
  const add = (t: GenTxn) => txns.push(t);
  let cardStatement = 0;

  for (let d = new Date(start); d <= today; d.setUTCDate(d.getUTCDate() + 1)) {
    const date = iso(d);
    const dom = d.getUTCDate();
    const dow = d.getUTCDay();
    const dayIndex = Math.round((d.getTime() - start.getTime()) / 86_400_000);

    // Income: biweekly paycheck on Fridays.
    if (dow === 5 && Math.floor(dayIndex / 7) % 2 === 0) {
      add({
        account: "checking",
        date,
        amount: toMinor(3850.42),
        raw: "ACME CORP PAYROLL PPD",
        merchant: "Acme Corp",
        category: "Paycheck",
      });
      add({
        account: "retirement",
        date,
        amount: toMinor(650),
        raw: "401K CONTRIBUTION",
        merchant: "Acme Corp 401(k)",
        category: "Transfer",
      });
    }

    // Housing & bills.
    if (dom === 1) {
      add({
        account: "checking",
        date,
        amount: -toMinor(2450),
        raw: "ROCKET MORTGAGE PMT",
        merchant: "Rocket Mortgage",
        category: "Mortgage & Rent",
      });
      add({
        account: "mortgage",
        date,
        amount: toMinor(between(880, 960)),
        raw: "PRINCIPAL PAYMENT",
        merchant: "Rocket Mortgage",
        category: "Transfer",
      });
      add({
        account: "checking",
        date,
        amount: -toMinor(500),
        raw: "TRANSFER TO SAVINGS",
        merchant: "Transfer",
        category: "Transfer",
      });
      add({
        account: "savings",
        date,
        amount: toMinor(500),
        raw: "TRANSFER FROM CHECKING",
        merchant: "Transfer",
        category: "Transfer",
      });
    }
    if (dom === 5)
      add({
        account: "checking",
        date,
        amount: -money(95, 210),
        raw: "PG&E WEB ONLINE",
        merchant: "PG&E",
        category: "Utilities",
      });
    if (dom === 8)
      add({
        account: "checking",
        date,
        amount: -toMinor(79.99),
        raw: "COMCAST XFINITY",
        merchant: "Xfinity",
        category: "Internet & Phone",
      });
    if (dom === 12)
      add({
        account: "card",
        date,
        amount: -toMinor(65),
        raw: "VERIZON WIRELESS",
        merchant: "Verizon",
        category: "Internet & Phone",
      });
    if (dom === 28)
      add({
        account: "savings",
        date,
        amount: money(48, 62),
        raw: "INTEREST PAYMENT",
        merchant: "Interest",
        category: "Interest",
      });

    // Subscriptions.
    if (dom === 3)
      add({
        account: "card",
        date,
        amount: -toMinor(15.49),
        raw: "NETFLIX.COM",
        merchant: "Netflix",
        category: "Subscriptions",
      });
    if (dom === 9)
      add({
        account: "card",
        date,
        amount: -toMinor(11.99),
        raw: "SPOTIFY USA",
        merchant: "Spotify",
        category: "Subscriptions",
      });
    if (dom === 14)
      add({
        account: "card",
        date,
        amount: -toMinor(2.99),
        raw: "APPLE.COM/BILL",
        merchant: "iCloud",
        category: "Subscriptions",
      });
    if (dom === 2)
      add({
        account: "card",
        date,
        amount: -toMinor(45),
        raw: "EQUINOX CLUB DUES",
        merchant: "Equinox",
        category: "Fitness",
      });

    // Everyday card spending.
    if (dow === 0 || (dow === 3 && rand() < 0.5)) {
      const store = pick([
        ["WHOLEFDS MKT #10234", "Whole Foods"],
        ["TRADER JOE S #552", "Trader Joe's"],
        ["SAFEWAY #1789", "Safeway"],
      ] as const);
      add({
        account: "card",
        date,
        amount: -money(60, 210),
        raw: store[0],
        merchant: store[1],
        category: "Groceries",
      });
    }
    if (rand() < 0.4) {
      const r = pick([
        ["SWEETGREEN SF", "Sweetgreen"],
        ["TST* NOPALITO", "Nopalito"],
        ["CHIPOTLE 2231", "Chipotle"],
        ["DOORDASH*THAI", "DoorDash"],
        ["SQ *TARTINE BAKERY", "Tartine"],
      ] as const);
      add({
        account: "card",
        date,
        amount: -money(14, 95),
        raw: r[0],
        merchant: r[1],
        category: "Restaurants",
      });
    }
    if (dow >= 1 && dow <= 5 && rand() < 0.55) {
      const c = pick([
        ["STARBUCKS STORE 0912", "Starbucks"],
        ["BLUE BOTTLE COFFEE", "Blue Bottle"],
        ["PHILZ COFFEE", "Philz Coffee"],
      ] as const);
      add({
        account: "card",
        date,
        amount: -money(4, 8),
        raw: c[0],
        merchant: c[1],
        category: "Coffee",
      });
    }
    if (dow === 6 && rand() < 0.8)
      add({
        account: "card",
        date,
        amount: -money(38, 68),
        raw: "CHEVRON 0204411",
        merchant: "Chevron",
        category: "Gas",
      });
    if (rand() < 0.12)
      add({
        account: "card",
        date,
        amount: -money(4, 38),
        raw: "UBER *TRIP",
        merchant: "Uber",
        category: "Rideshare & Transit",
      });
    if (rand() < 0.18)
      add({
        account: "card",
        date,
        amount: -money(12, 180),
        raw: "AMZN Mktp US*2K4L",
        merchant: "Amazon",
        category: "Shopping",
      });
    if (rand() < 0.04)
      add({
        account: "card",
        date,
        amount: -money(40, 260),
        raw: "TARGET 00012",
        merchant: "Target",
        category: "Shopping",
      });
    if (rand() < 0.05)
      add({
        account: "card",
        date,
        amount: -money(18, 90),
        raw: "AMC THEATRES",
        merchant: "AMC",
        category: "Entertainment",
      });
    if (rand() < 0.008)
      add({
        account: "card",
        date,
        amount: -money(280, 900),
        raw: "UNITED AIRLINES",
        merchant: "United Airlines",
        category: "Travel",
      });

    // Pay the card statement in full on the 20th.
    if (dom === 20 && cardStatement > 0) {
      add({
        account: "checking",
        date,
        amount: -cardStatement,
        raw: "CHASE CREDIT CRD AUTOPAY",
        merchant: "Chase",
        category: "Credit Card Payment",
      });
      add({
        account: "card",
        date,
        amount: cardStatement,
        raw: "AUTOMATIC PAYMENT - THANK YOU",
        merchant: "Chase",
        category: "Credit Card Payment",
      });
      cardStatement = 0;
    }
    for (const t of txns) {
      if (t.date === date && t.account === "card" && t.amount < 0) cardStatement += -t.amount;
    }
  }

  // Opening balances (liabilities are positive "amount owed").
  const opening: Record<AccountKey, number> = {
    checking: toMinor(4200),
    savings: toMinor(18000),
    card: toMinor(1250),
    brokerage: toMinor(42000),
    retirement: toMinor(88000),
    mortgage: toMinor(312000),
    home: toMinor(545000),
  };
  const liability: Record<AccountKey, boolean> = {
    checking: false,
    savings: false,
    card: true,
    brokerage: false,
    retirement: false,
    mortgage: true,
    home: false,
  };

  return withHousehold(db, householdId, async (tx) => {
    const acct = await insertAccounts(tx, householdId);
    const catIds = await categoryIds(tx, householdId);
    const merchIds = await upsertMerchants(tx, householdId, txns, catIds);

    // Mark the last two days of card activity as pending.
    const pendingCutoff = iso(new Date(today.getTime() - 2 * 86_400_000));
    const rows = txns.map((t, i) => ({
      householdId,
      accountId: acct[t.account],
      providerTransactionId: `demo-${i}`,
      date: t.date,
      amount: t.amount,
      pending: t.account === "card" && t.date > pendingCutoff,
      rawDescription: t.raw,
      merchantId: merchIds.get(t.merchant) ?? null,
      categoryId: catIds.get(t.category) ?? null,
      reviewed: t.date < pendingCutoff,
    }));
    for (let i = 0; i < rows.length; i += 500) {
      await tx.insert(transactions).values(rows.slice(i, i + 500));
    }

    // Daily snapshots, replaying transactions; investments random-walk upward.
    const balances = { ...opening };
    const byDate = new Map<string, GenTxn[]>();
    for (const t of txns) byDate.set(t.date, [...(byDate.get(t.date) ?? []), t]);
    const snaps: (typeof balanceSnapshots.$inferInsert)[] = [];
    for (let d = new Date(start); d <= today; d.setUTCDate(d.getUTCDate() + 1)) {
      const date = iso(d);
      for (const t of byDate.get(date) ?? []) {
        balances[t.account] += liability[t.account] ? -t.amount : t.amount;
      }
      for (const k of ["brokerage", "retirement"] as const) {
        balances[k] = Math.round(balances[k] * (1 + 0.00028 + (rand() - 0.5) * 0.018));
      }
      balances.home = Math.round(balances.home * 1.0001); // ~3.7%/yr appreciation
      for (const k of Object.keys(acct) as AccountKey[]) {
        snaps.push({ householdId, accountId: acct[k], date, balance: balances[k] });
      }
    }
    for (let i = 0; i < snaps.length; i += 1000) {
      await tx.insert(balanceSnapshots).values(snaps.slice(i, i + 1000));
    }
    for (const k of Object.keys(acct) as AccountKey[]) {
      await tx
        .update(accounts)
        .set({
          currentBalance: balances[k],
          availableBalance: k === "checking" || k === "savings" ? balances[k] : null,
          balanceUpdatedAt: new Date(),
        })
        .where(eq(accounts.id, acct[k]));
    }

    // Holdings that add up to each investment account's final balance.
    const portfolio = (
      accountId: string,
      total: number,
      mix: [string, string, string, number, number, number][],
    ) =>
      mix.map(([symbol, name, type, weight, price, basisRatio]) => {
        const value = Math.round(total * weight);
        return {
          accountId,
          security: {
            providerSecurityId: `demo:${symbol}`,
            symbol,
            name,
            type,
            currency: "USD",
            price: price.toFixed(2),
          },
          quantity: (value / 100 / price).toFixed(4),
          value,
          costBasis: type === "cash" ? value : Math.round(value * basisRatio),
        };
      });
    await replaceHoldings(
      tx,
      householdId,
      [acct.brokerage, acct.retirement],
      [
        ...portfolio(acct.brokerage, balances.brokerage, [
          ["VTI", "Vanguard Total Stock Market ETF", "etf", 0.5, 312.4, 0.78],
          ["VXUS", "Vanguard Total International Stock ETF", "etf", 0.2, 68.15, 0.9],
          ["BND", "Vanguard Total Bond Market ETF", "etf", 0.15, 73.02, 1.03],
          ["AAPL", "Apple Inc.", "equity", 0.1, 241.8, 0.62],
          ["CASH", "Cash sweep", "cash", 0.05, 1, 1],
        ]),
        ...portfolio(acct.retirement, balances.retirement, [
          ["VFIFX", "Vanguard Target Retirement 2050 Fund", "mutual fund", 0.85, 58.9, 0.82],
          ["VBTLX", "Vanguard Total Bond Market Index Admiral", "fixed income", 0.15, 9.85, 1.02],
        ]),
      ],
    );
    return { transactions: rows.length, snapshots: snaps.length };
  });
}

async function insertAccounts(tx: Tx, householdId: string): Promise<Record<AccountKey, string>> {
  const defs: { key: AccountKey; v: Omit<typeof accounts.$inferInsert, "householdId"> }[] = [
    {
      key: "checking",
      v: {
        name: "Everyday Checking",
        type: "depository",
        subtype: "checking",
        mask: "4821",
        sortOrder: 0,
      },
    },
    {
      key: "savings",
      v: {
        name: "High-Yield Savings",
        type: "depository",
        subtype: "savings",
        mask: "9930",
        sortOrder: 1,
      },
    },
    {
      key: "card",
      v: {
        name: "Sapphire Preferred",
        type: "credit",
        subtype: "credit card",
        mask: "1107",
        creditLimit: toMinor(15000),
        sortOrder: 2,
      },
    },
    {
      key: "brokerage",
      v: {
        name: "Brokerage",
        type: "investment",
        subtype: "brokerage",
        mask: "7713",
        sortOrder: 3,
      },
    },
    {
      key: "retirement",
      v: { name: "401(k)", type: "investment", subtype: "401k", mask: "0042", sortOrder: 4 },
    },
    {
      key: "mortgage",
      v: { name: "Home Mortgage", type: "loan", subtype: "mortgage", mask: "5560", sortOrder: 5 },
    },
    {
      key: "home",
      v: { name: "Home (estimate)", type: "property", subtype: "real estate", sortOrder: 6 },
    },
  ];
  const out = {} as Record<AccountKey, string>;
  for (const d of defs) {
    const [row] = await tx
      .insert(accounts)
      .values({ ...d.v, householdId })
      .returning({ id: accounts.id });
    if (!row) throw new Error("account insert failed");
    out[d.key] = row.id;
  }
  return out;
}

async function categoryIds(tx: Tx, householdId: string): Promise<Map<string, string>> {
  const rows = await tx
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(eq(categories.householdId, householdId));
  return new Map(rows.map((r) => [r.name, r.id]));
}

async function upsertMerchants(
  tx: Tx,
  householdId: string,
  txns: GenTxn[],
  catIds: Map<string, string>,
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (const t of txns) if (!names.has(t.merchant)) names.set(t.merchant, t.category);
  const rows = await tx
    .insert(merchants)
    .values(
      [...names].map(([name, cat]) => ({
        householdId,
        name,
        defaultCategoryId: catIds.get(cat) ?? null,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: merchants.id, name: merchants.name });
  return new Map(rows.map((r) => [r.name, r.id]));
}
