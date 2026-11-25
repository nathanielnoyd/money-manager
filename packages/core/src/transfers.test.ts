import { describe, expect, it } from "vitest";
import { matchTransfers, type TransferCandidate } from "./transfers";

const row = (
  id: string,
  accountId: string,
  amount: number,
  o: Partial<TransferCandidate> = {},
): TransferCandidate => ({
  id,
  accountId,
  accountType: "depository",
  date: "2026-03-10",
  amount,
  description: "",
  fresh: true,
  ...o,
});

describe("matchTransfers", () => {
  it("pairs a card payment by account type alone", () => {
    expect(
      matchTransfers([
        row("a", "checking", -50000, { description: "CHASE CREDIT CRD EPAY" }),
        row("b", "card", 50000, { accountType: "credit", date: "2026-03-11" }),
      ]),
    ).toEqual([{ outId: "a", inId: "b", cardPayment: true }]);
  });

  it("pairs a move between bank accounts only when a description says so", () => {
    const pair = (out: string, inn: string) =>
      matchTransfers([
        row("a", "checking", -20000, { description: out }),
        row("b", "savings", 20000, { description: inn }),
      ]);
    expect(pair("ONLINE TRANSFER TO SAV 1234", "DEPOSIT")).toHaveLength(1);
    expect(pair("WITHDRAWAL", "Online Xfer from CHK")).toHaveLength(1);
    // A $200 purchase and an unrelated $200 refund elsewhere are not a transfer.
    expect(pair("BEST BUY 0042", "VENMO CASHOUT")).toEqual([]);
  });

  it("needs exact opposite amounts, different accounts and nearby dates", () => {
    const out = row("a", "checking", -10000, { description: "TRANSFER" });
    expect(matchTransfers([out, row("b", "savings", 10001)])).toEqual([]);
    expect(matchTransfers([out, row("b", "checking", 10000)])).toEqual([]);
    expect(matchTransfers([out, row("b", "savings", 10000, { date: "2026-03-14" })])).toEqual([]);
    expect(matchTransfers([out, row("b", "savings", 10000, { date: "2026-03-13" })])).toHaveLength(
      1,
    );
  });

  it("leaves ambiguous cases alone", () => {
    const t = { description: "TRANSFER" };
    // Two possible destinations for one withdrawal.
    expect(
      matchTransfers([
        row("a", "checking", -10000, t),
        row("b", "savings", 10000),
        row("c", "brokerage", 10000),
      ]),
    ).toEqual([]);
    // Two possible sources for one deposit.
    expect(
      matchTransfers([
        row("a", "checking", -10000, t),
        row("b", "joint", -10000, t),
        row("c", "savings", 10000),
      ]),
    ).toEqual([]);
  });

  it("doesn't touch pairs that are both old", () => {
    expect(
      matchTransfers([
        row("a", "checking", -10000, { description: "TRANSFER", fresh: false }),
        row("b", "savings", 10000, { fresh: false }),
      ]),
    ).toEqual([]);
  });

  it("doesn't call money leaving a card a payment", () => {
    expect(
      matchTransfers([
        row("a", "card", -30000, { accountType: "credit", description: "CASH ADVANCE" }),
        row("b", "checking", 30000, { description: "ATM DEPOSIT" }),
      ]),
    ).toEqual([]);
  });
});
