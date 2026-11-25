import { parseArgs } from "node:util";
import { sql } from "drizzle-orm";
import { createDb, createPool } from "../client";
import { readSecret } from "../secrets";
import { seedDemoData } from "../seed";

/**
 * Seed realistic fake data into a household (development / demo only).
 *   pnpm db:seed                    # first household
 *   pnpm db:seed --household <id>
 */
const { values } = parseArgs({
  options: {
    household: { type: "string" },
    months: { type: "string", default: "12" },
    seed: { type: "string", default: "42" },
  },
});

const pool = createPool(readSecret("DATABASE_ADMIN_URL", true), 2, { statementTimeoutMs: 0 });
try {
  const db = createDb(pool);
  let householdId = values.household;
  if (!householdId) {
    const { rows } = await db.execute<{ id: string }>(
      sql`select id from households order by created_at limit 1`,
    );
    householdId = rows[0]?.id;
  }
  if (!householdId) {
    console.error("No household found. Complete first-run setup in the app first, then re-run.");
    process.exitCode = 1;
  } else {
    const { rows } = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from accounts where household_id = ${householdId}`,
    );
    if ((rows[0]?.n ?? 0) > 0) {
      console.error("That household already has accounts; refusing to seed over real data.");
      process.exitCode = 1;
    } else {
      const result = await seedDemoData(db, householdId, {
        months: Number(values.months),
        seed: Number(values.seed),
      });
      console.log(
        `✓ Seeded household ${householdId}: ${result.transactions} transactions, ${result.snapshots} balance snapshots`,
      );
    }
  }
} finally {
  await pool.end();
}
