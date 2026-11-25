/**
 * Tolerant OFX/QFX reader for both SGML (OFX 1.x, unclosed tags) and XML (OFX 2.x).
 * Extracts the statement's account, ledger balance and transactions.
 */

export interface OfxTransaction {
  fitId: string;
  date: string; // YYYY-MM-DD
  amount: string; // decimal string as in the file
  name: string;
  memo?: string;
  type?: string;
}

export interface OfxStatement {
  accountId?: string;
  accountType?: "depository" | "credit" | "investment";
  currency?: string;
  ledgerBalance?: string;
  balanceDate?: string;
  transactions: OfxTransaction[];
}

function tag(block: string, name: string): string | undefined {
  const re = new RegExp(`<${name}>([^<\\r\\n]*)`, "i");
  const v = re.exec(block)?.[1]?.trim();
  return v ? decodeEntities(v) : undefined;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  "#39": "'",
};

/** Decode the XML entities OFX uses, in a single pass so "&amp;lt;" stays "&lt;". */
function decodeEntities(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|apos|#39);/g, (_m, e: string) => ENTITIES[e] ?? _m);
}

function ofxDate(v?: string): string | undefined {
  const m = v ? /^(\d{4})(\d{2})(\d{2})/.exec(v) : null;
  return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
}

export function parseOfx(text: string): OfxStatement {
  const body = text.slice(Math.max(0, text.search(/<OFX>/i)));
  const transactions: OfxTransaction[] = [];
  const blocks = body.split(/<STMTTRN>/i).slice(1);
  for (const raw of blocks) {
    const block = raw.split(/<\/STMTTRN>|<\/BANKTRANLIST>/i)[0] ?? raw;
    const date = ofxDate(tag(block, "DTPOSTED") ?? tag(block, "DTUSER"));
    const amount = tag(block, "TRNAMT");
    if (!date || !amount) continue;
    const name = tag(block, "NAME") ?? tag(block, "PAYEE") ?? tag(block, "MEMO") ?? "Unknown";
    transactions.push({
      fitId: tag(block, "FITID") ?? "",
      date,
      amount,
      name,
      memo: tag(block, "MEMO"),
      type: tag(block, "TRNTYPE"),
    });
  }
  const ledger =
    /<LEDGERBAL>([\s\S]*?)(<\/LEDGERBAL>|<AVAILBAL>|<\/STMTRS>|$)/i.exec(body)?.[1] ?? "";
  const accountType = /<CCACCTFROM>/i.test(body)
    ? "credit"
    : /<INVACCTFROM>/i.test(body)
      ? "investment"
      : /<BANKACCTFROM>/i.test(body)
        ? "depository"
        : undefined;
  return {
    accountId: tag(body, "ACCTID"),
    accountType,
    currency: tag(body, "CURDEF"),
    ledgerBalance: tag(ledger, "BALAMT"),
    balanceDate: ofxDate(tag(ledger, "DTASOF")),
    transactions,
  };
}
