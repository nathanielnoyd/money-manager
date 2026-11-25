import type { NormalizedAccount } from "./types";

/** Providers like SimpleFIN don't report an account type; infer one from the name. */
export function guessAccountType(
  name: string,
  balance: number,
): Pick<NormalizedAccount, "type" | "subtype"> {
  const n = name.toLowerCase();
  if (/mortgage/.test(n)) return { type: "loan", subtype: "mortgage" };
  if (/\b(loan|heloc|auto|student)\b/.test(n)) return { type: "loan", subtype: "loan" };
  if (
    /credit|card|visa|mastercard|amex|american express|discover|sapphire|freedom|venture|platinum/.test(
      n,
    )
  )
    return { type: "credit", subtype: "credit card" };
  if (/401\s?\(?k\)?|403b|\bira\b|roth|retirement|pension|\bhsa\b/.test(n))
    return { type: "investment", subtype: "retirement" };
  if (/brokerage|invest|trading|stock|crypto|coinbase|robinhood|fidelity|vanguard|schwab/.test(n))
    return { type: "investment", subtype: "brokerage" };
  if (/saving|money market|\bmma\b|\bcd\b/.test(n))
    return { type: "depository", subtype: "savings" };
  if (/checking|chk|debit|spending|everyday/.test(n))
    return { type: "depository", subtype: "checking" };
  return balance < 0 ? { type: "credit", subtype: "credit card" } : { type: "depository" };
}
