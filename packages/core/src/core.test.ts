import { describe, expect, it } from "vitest";
import {
  appTimeZone,
  csvField,
  formatMoney,
  isoDateIn,
  minorToDecimal,
  netWorth,
  parseCsv,
  toCsv,
  toMinor,
} from "./index";

describe("money", () => {
  it("converts to minor units without float drift", () => {
    expect(toMinor(19.99)).toBe(1999);
    expect(toMinor(0.1 + 0.2)).toBe(30);
  });

  it("formats currency", () => {
    expect(formatMoney(123456)).toBe("$1,234.56");
    expect(formatMoney(-500, "USD", { signed: true })).toBe("-$5.00");
    expect(formatMoney(500, "USD", { signed: true })).toBe("+$5.00");
  });
});

describe("netWorth", () => {
  it("subtracts liabilities and skips excluded accounts", () => {
    expect(
      netWorth([
        { type: "depository", currentBalance: 10_000_00, includeInNetWorth: true },
        { type: "credit", currentBalance: 1_500_00, includeInNetWorth: true },
        { type: "investment", currentBalance: 50_000_00, includeInNetWorth: false },
      ]),
    ).toBe(8_500_00);
  });
});

describe("formatMoney edge cases", () => {
  it("never renders negative zero", () => {
    expect(formatMoney(-0)).toBe("$0.00");
  });
});

describe("writing files for other programs", () => {
  it("writes minor units as exact decimals", () => {
    expect(minorToDecimal(0)).toBe("0.00");
    expect(minorToDecimal(5)).toBe("0.05");
    expect(minorToDecimal(-5)).toBe("-0.05");
    expect(minorToDecimal(-1250)).toBe("-12.50");
    expect(minorToDecimal(123456789012)).toBe("1234567890.12");
    expect(minorToDecimal(1999, 0)).toBe("1999");
  });

  it("quotes fields and defuses spreadsheet formulas in text, not in amounts", () => {
    expect(csvField('He said "hi", twice')).toBe('"He said ""hi"", twice"');
    expect(csvField("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvField("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvField("-12.50", true)).toBe("-12.50");
    expect(csvField(null)).toBe("");
    const csv = toCsv(
      [
        ["Date", "Description", "Amount"],
        ["2026-03-01", "+1 (800) REFUND, INC", "-12.50"],
        ["2026-03-02", "line one\nline two", "40.00"],
      ],
      [2],
    );
    expect(parseCsv(csv, ",")).toEqual([
      ["Date", "Description", "Amount"],
      ["2026-03-01", "'+1 (800) REFUND, INC", "-12.50"],
      ["2026-03-02", "line one\nline two", "40.00"],
    ]);
  });
});

describe("today, in a time zone", () => {
  it("gives the local calendar date, not the UTC one", () => {
    const lateEvening = new Date("2026-03-01T03:30:00Z"); // 7:30pm on Feb 28 in Los Angeles
    expect(isoDateIn(lateEvening, "UTC")).toBe("2026-03-01");
    expect(isoDateIn(lateEvening, "America/Los_Angeles")).toBe("2026-02-28");
    expect(isoDateIn(lateEvening, "Asia/Tokyo")).toBe("2026-03-01");
    expect(isoDateIn(new Date("2026-12-31T23:30:00Z"), "Pacific/Auckland")).toBe("2027-01-01");
  });

  it("uses a valid zone", () => {
    expect(() => new Intl.DateTimeFormat("en-CA", { timeZone: appTimeZone() })).not.toThrow();
  });
});
