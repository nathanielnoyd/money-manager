/**
 * Turn a raw bank description into a readable merchant name, e.g.
 *   "SQ *TARTINE BAKERY SAN FRANCISCO CA" → "Tartine Bakery"
 *   "AMZN Mktp US*2K4L81"                 → "Amazon"
 *   "STARBUCKS STORE 0912"                → "Starbucks"
 * Heuristic and conservative: users can always rename, and rules can override.
 */

const KNOWN: [RegExp, string][] = [
  [/\bamzn\b|amazon(\.com)?|amzn mktp/i, "Amazon"],
  [/\buber\s*\*?\s*eats\b/i, "Uber Eats"],
  [/\buber\b/i, "Uber"],
  [/\blyft\b/i, "Lyft"],
  [/\bdoordash\b|\bdd\s*\*/i, "DoorDash"],
  [/apple\.com\/bill|\bitunes\b/i, "Apple"],
  [/\bnetflix\b/i, "Netflix"],
  [/\bspotify\b/i, "Spotify"],
  [/\bstarbucks\b/i, "Starbucks"],
  [/\bwhole\s*f(oo)?ds\b|wholefds/i, "Whole Foods"],
  [/\btrader joe/i, "Trader Joe's"],
  [/\bcostco\b/i, "Costco"],
  [/\btarget\b/i, "Target"],
  [/\bwal-?mart\b|\bwm supercenter\b/i, "Walmart"],
  [/\bpaypal\b/i, "PayPal"],
  [/\bvenmo\b/i, "Venmo"],
  [/\bzelle\b/i, "Zelle"],
  [/\bgoogle\b/i, "Google"],
  [/\bchevron\b/i, "Chevron"],
  [/\bshell (oil|service)\b/i, "Shell"],
];

const PREFIXES =
  /^(sq\s*\*|tst\s*\*|sp\s*\*|pp\s*\*|paypal\s*\*|pos\s+(debit|purchase)?|debit\s+(card\s+)?purchase|purchase\s+authorized\s+on\s+\d{2}\/\d{2}|recurring\s+payment|checkcard\s+\d{4}|ach\s+(debit|credit)|card\s+\d{4})\s*/i;

const US_STATES =
  "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC";

/** Words that start two-word city names, so "SAN FRANCISCO CA" is stripped whole but "COFFEE OAKLAND CA" keeps "COFFEE". */
const CITY_PREFIX =
  "SAN|SANTA|LOS|LAS|NEW|ST|SAINT|FORT|FT|EL|PALO|SOUTH|NORTH|WEST|EAST|LAKE|SALT|LONG|DALY|REDWOOD|MOUNTAIN|SIOUX|BATON|GRAND|COLORADO|KANSAS|OKLAHOMA|JERSEY|VIRGINIA|ST\\.";
const CITY_STATE = new RegExp(
  ` (?:(?:${CITY_PREFIX}) )?[A-Za-z.]+ (?:${US_STATES})(?: \\d{5})?$`,
  "i",
);

/** Bank descriptions are short; anything longer is cut before the pattern matching below. */
const MAX_DESCRIPTION = 200;

export function cleanMerchantName(raw: string): string {
  // Collapse whitespace first. The patterns below then match single spaces, which keeps each
  // of them linear in the length of the description (it is untrusted text from a bank).
  const original = raw.replace(/\s+/g, " ").trim().slice(0, MAX_DESCRIPTION);
  for (const [re, name] of KNOWN) if (re.test(original)) return name;

  let s = original;
  for (let i = 0; i < 3; i++) s = s.replace(PREFIXES, "");
  s = s
    .replace(/ \d{2}\/\d{2}(\/\d{2,4})?\b.*$/, "") // trailing dates
    .replace(CITY_STATE, "") // "… SAN FRANCISCO CA", "… OAKLAND CA 94612"
    .replace(/ ?(#|store|str|no\.?) ?\d+.*$/i, "") // store numbers
    .replace(/ ?\* ?[A-Z0-9]{4,}$/i, "") // reference codes after *
    .replace(/ \d{3,}.*$/, "") // trailing long numbers
    .replace(/[*_]+/g, " ")
    .replace(/ +/g, " ")
    .trim();
  if (s.length < 2) s = original;
  return titleCase(s);
}

function titleCase(s: string): string {
  if (/[a-z]/.test(s) && /[A-Z]/.test(s)) return s; // already mixed case, keep it
  return s
    .toLowerCase()
    .split(" ")
    .map((w) => (w.length <= 3 && /^(llc|inc|usa|atm|bp|cvs)$/.test(w) ? w.toUpperCase() : w))
    .map((w) => (w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ")
    .replace(/'S\b/g, "'s");
}
