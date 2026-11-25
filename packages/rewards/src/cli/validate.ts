import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type Catalog, checkCatalog } from "../catalog";
import { CARD_FILE_NAMES } from "../data";
import { type Card, CardFile, ProgramFile } from "../schema";

/**
 * Validate the catalog folder (programs.json + cards/*.json) against the schemas, run the
 * cross-file checks, and make sure src/data.ts imports every card file.
 * Usage: pnpm --filter @mm/rewards catalog:validate [dir]
 */
const dir = process.argv[2] ?? fileURLToPath(new URL("../../catalog", import.meta.url));

function load(): Catalog {
  const problems: string[] = [];
  const read = (file: string) => JSON.parse(readFileSync(`${dir}/${file}`, "utf8")) as unknown;
  const p = ProgramFile.safeParse(read("programs.json"));
  const programs = p.success ? p.data.programs : [];
  if (!p.success)
    problems.push(...p.error.issues.map((i) => `programs.json ${i.path.join(".")}: ${i.message}`));
  const cards: Card[] = [];
  const files = readdirSync(`${dir}/cards`)
    .filter((f) => f.endsWith(".json"))
    .sort();
  for (const file of files) {
    const c = CardFile.safeParse(read(`cards/${file}`));
    if (c.success) cards.push(...c.data.cards);
    else
      problems.push(
        ...c.error.issues.map((i) => `cards/${file} ${i.path.join(".")}: ${i.message}`),
      );
  }
  problems.push(...checkCatalog({ programs, cards }));
  const missing = files.filter((f) => !CARD_FILE_NAMES.includes(f));
  if (missing.length) problems.push(`not imported in src/data.ts: ${missing.join(", ")}`);
  if (problems.length)
    throw new Error(`Catalog has ${problems.length} problem(s):\n- ${problems.join("\n- ")}`);
  return { programs, cards };
}

try {
  const { programs, cards } = load();
  console.log(`✓ catalog valid: ${programs.length} programs, ${cards.length} cards`);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
