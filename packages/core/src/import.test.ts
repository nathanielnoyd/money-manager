import { describe, expect, it } from "vitest";
import {
  applyRules,
  cleanMerchantName,
  csvToTransactions,
  detectDateFormat,
  guessCsvMapping,
  ofxToTransactions,
  parseCsv,
  parseDate,
  parseDecimalToMinor,
  type RuleDef,
} from "./index";

describe("parseDecimalToMinor", () => {
  it.each([
    ["1,234.56", 123456],
    ["-12.3", -1230],
    ["(45.00)", -4500],
    ["$9", 900],
    ["0.005", 1],
    ["12.34-", -1234],
    ["+7.10", 710],
    ["−3.00", -300],
  ])("%s → %i", (s, v) => expect(parseDecimalToMinor(s)).toBe(v));
  it.each(["", "abc", "1.2.3", "-"])("rejects %j", (s) =>
    expect(parseDecimalToMinor(s)).toBeNull(),
  );
});

describe("cleanMerchantName", () => {
  it.each([
    ["SQ *TARTINE BAKERY SAN FRANCISCO CA", "Tartine Bakery"],
    ["AMZN Mktp US*2K4L81", "Amazon"],
    ["STARBUCKS STORE 0912", "Starbucks"],
    ["TST* NOPALITO", "Nopalito"],
    ["CHEVRON 0204411", "Chevron"],
    ["UBER *EATS PENDING", "Uber Eats"],
    ["Blue Bottle Coffee", "Blue Bottle Coffee"],
    ["PURCHASE AUTHORIZED ON 03/14 SAFEWAY #1789 OAKLAND CA", "Safeway"],
    ["SQ  *TARTINE   BAKERY\tSAN FRANCISCO  CA", "Tartine Bakery"],
    ["BLUE BOTTLE COFFEE OAKLAND CA 94612", "Blue Bottle Coffee"],
    ["CORNER SHOP * AB12CD", "Corner Shop"],
    ["LOCAL DINER 04/17 CARD 1234", "Local Diner"],
  ])("%s → %s", (raw, clean) => expect(cleanMerchantName(raw)).toBe(clean));

  it("bounds the work done on a hostile description", () => {
    const hostile = `x${" ".repeat(200_000)}y${" 1".repeat(50_000)}`;
    expect(cleanMerchantName(hostile).length).toBeLessThanOrEqual(200);
  });
});

describe("CSV", () => {
  it("parses quoted fields, escaped quotes and CRLF", () => {
    const rows = parseCsv('Date,Description,Amount\r\n2026-01-02,"Coffee, ""large""",-4.50\r\n');
    expect(rows).toEqual([
      ["Date", "Description", "Amount"],
      ["2026-01-02", 'Coffee, "large"', "-4.50"],
    ]);
  });

  it("parses dates in each order and rejects impossible ones", () => {
    expect(parseDate("03/14/2026", "MDY")).toBe("2026-03-14");
    expect(parseDate("14.03.26", "DMY")).toBe("2026-03-14");
    expect(parseDate("20260314", "MDY")).toBe("2026-03-14");
    expect(parseDate("02/30/2026", "MDY")).toBeNull();
    expect(detectDateFormat(["03/14/2026", "12/01/2026"])).toBe("MDY");
    expect(detectDateFormat(["14/03/2026", "01/12/2026"])).toBe("DMY");
  });

  it("guesses a split debit/credit mapping and produces stable ids", () => {
    const csv =
      "Posting Date,Description,Debit,Credit\n01/05/2026,COFFEE,4.50,\n01/06/2026,PAYROLL,,1000.00\n01/06/2026,COFFEE,4.50,\n01/05/2026,COFFEE,4.50,\n";
    const rows = parseCsv(csv);
    const map = guessCsvMapping(rows);
    expect(map).toMatchObject({
      hasHeader: true,
      dateColumn: 0,
      descriptionColumn: 1,
      debitColumn: 2,
      creditColumn: 3,
    });
    const { transactions, errors } = csvToTransactions(rows, map);
    expect(errors).toEqual([]);
    expect(transactions.map((t) => t.amount)).toEqual([-450, 100000, -450, -450]);
    // Identical rows on the same day get distinct ids; re-parsing gives the same ids.
    expect(new Set(transactions.map((t) => t.providerTransactionId)).size).toBe(4);
    expect(csvToTransactions(rows, map).transactions.map((t) => t.providerTransactionId)).toEqual(
      transactions.map((t) => t.providerTransactionId),
    );
  });

  it("reports unreadable rows instead of guessing", () => {
    const rows = parseCsv("Date,Description,Amount\nnot a date,X,1\n2026-01-01,Y,abc\n");
    const { transactions, errors } = csvToTransactions(rows, guessCsvMapping(rows));
    expect(transactions).toHaveLength(0);
    expect(errors.map((e) => e.row)).toEqual([2, 3]);
  });
});

describe("OFX", () => {
  const sgml = `OFXHEADER:100
DATA:OFXSGML

<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><CURDEF>USD
<CCACCTFROM><ACCTID>XXXX1107</CCACCTFROM>
<BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260303120000[-5:EST]<TRNAMT>-15.49<FITID>2026030301<NAME>NETFLIX.COM</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260320<TRNAMT>812.33<FITID>2026032001<NAME>PAYMENT &amp; THANK YOU</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>-1234.56<DTASOF>20260331</LEDGERBAL>
</CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>`;

  it("reads SGML statements", () => {
    const r = ofxToTransactions(sgml);
    expect(r.statement).toMatchObject({
      accountId: "XXXX1107",
      accountType: "credit",
      currency: "USD",
      ledgerBalance: "-1234.56",
      balanceDate: "2026-03-31",
    });
    expect(r.transactions).toEqual([
      {
        providerTransactionId: "ofx:2026030301",
        date: "2026-03-03",
        amount: -1549,
        description: "NETFLIX.COM",
        pending: false,
      },
      {
        providerTransactionId: "ofx:2026032001",
        date: "2026-03-20",
        amount: 81233,
        description: "PAYMENT & THANK YOU",
        pending: false,
      },
    ]);
  });

  it("reads XML statements", () => {
    const xml = `<?xml version="1.0"?><OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>USD</CURDEF><BANKACCTFROM><ACCTID>9930</ACCTID></BANKACCTFROM><BANKTRANLIST><STMTTRN><TRNTYPE>INT</TRNTYPE><DTPOSTED>20260228</DTPOSTED><TRNAMT>52.10</TRNAMT><FITID>abc</FITID><NAME>INTEREST</NAME></STMTTRN></BANKTRANLIST><LEDGERBAL><BALAMT>21326.45</BALAMT><DTASOF>20260228</DTASOF></LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
    const r = ofxToTransactions(xml);
    expect(r.statement.accountType).toBe("depository");
    expect(r.statement.ledgerBalance).toBe("21326.45");
    expect(r.transactions[0]).toMatchObject({ amount: 5210, description: "INTEREST" });
  });

  it("decodes entities once, so an escaped entity stays literal", () => {
    const xml = `<OFX><BANKACCTFROM><ACCTID>1</ACCTID></BANKACCTFROM><STMTTRN><DTPOSTED>20260301</DTPOSTED><TRNAMT>-1.00</TRNAMT><FITID>e1</FITID><NAME>A &amp;lt;B&amp;gt; &amp; C &#39;D&#39;</NAME></STMTTRN></OFX>`;
    expect(ofxToTransactions(xml).transactions[0]?.description).toBe("A &lt;B&gt; & C 'D'");
  });
});

describe("rules", () => {
  const rules: RuleDef[] = [
    {
      id: "broad",
      priority: 10,
      enabled: true,
      conditions: [{ field: "description", op: "contains", value: "amzn" }],
      actions: { setCategoryId: "shopping", markReviewed: true },
    },
    {
      id: "specific",
      priority: 1,
      enabled: true,
      conditions: [
        { field: "description", op: "contains", value: "amzn" },
        { field: "amount", op: "equals", value: 1499 },
      ],
      actions: { setCategoryId: "subscriptions" },
    },
    {
      id: "off",
      priority: 0,
      enabled: false,
      conditions: [{ field: "description", op: "contains", value: "amzn" }],
      actions: { exclude: true },
    },
    {
      id: "income",
      priority: 5,
      enabled: true,
      conditions: [
        { field: "direction", op: "equals", value: "in" },
        { field: "amount", op: "gt", value: 100000 },
      ],
      actions: { setCategoryId: "paycheck" },
    },
  ];

  it("first matching rule per field wins, by priority", () => {
    const r = applyRules(rules, { description: "AMZN Prime", amount: -1499, accountId: "a" });
    expect(r).toEqual({
      matchedRuleIds: ["specific", "broad"],
      setCategoryId: "subscriptions",
      markReviewed: true,
    });
  });

  it("ignores disabled rules and checks direction and amount", () => {
    expect(
      applyRules(rules, { description: "AMZN", amount: -2000, accountId: "a" }).exclude,
    ).toBeUndefined();
    expect(
      applyRules(rules, { description: "ACME PAYROLL", amount: 385042, accountId: "a" })
        .setCategoryId,
    ).toBe("paycheck");
    expect(
      applyRules(rules, { description: "REFUND", amount: 5000, accountId: "a" }).matchedRuleIds,
    ).toEqual([]);
  });

  it("matches any of several terms, and never evaluates legacy regex conditions", () => {
    const any: RuleDef = {
      id: "ride",
      priority: 0,
      enabled: true,
      conditions: [{ field: "description", op: "contains_any", value: "uber | lyft|cabify" }],
      actions: { setCategoryId: "rides" },
    };
    expect(
      applyRules([any], { description: "LYFT *RIDE 0412", amount: -1800, accountId: "a" })
        .setCategoryId,
    ).toBe("rides");
    expect(
      applyRules([any], { description: "UBERCUT SALON", amount: -1800, accountId: "a" })
        .setCategoryId,
    ).toBe("rides");
    expect(
      applyRules([any], { description: "SHELL OIL", amount: -1800, accountId: "a" }).matchedRuleIds,
    ).toEqual([]);

    // A stored rule from before regex was removed: evaluated as "no match", instantly.
    const legacy = {
      id: "x",
      priority: 0,
      enabled: true,
      conditions: [{ field: "description", op: "regex", value: "(\\w+\\s?)+$" }],
      actions: { exclude: true },
    } as unknown as RuleDef;
    const t0 = Date.now();
    expect(
      applyRules([legacy], { description: `${"a".repeat(40)}!`, amount: -1, accountId: "a" })
        .matchedRuleIds,
    ).toEqual([]);
    // If the pattern ran it would backtrack for hours; a second leaves room for a loaded CI runner.
    expect(Date.now() - t0).toBeLessThan(1_000);
  });
});
