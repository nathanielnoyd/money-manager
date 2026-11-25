import {
  type Ai,
  AiBudgetError,
  categorizeUncategorized,
  createAi,
  generateWeeklyDigest,
  parseAiSettings,
} from "@mm/ai";
import { safeSendNtfy } from "@mm/connectors";
import { parseNotifySettings } from "@mm/core";
import { type Db, readSecret, schema, withHousehold } from "@mm/db";
import { eq, sql } from "drizzle-orm";
import { log } from "../log";

let cached: Ai | null | undefined;
export function workerAi(): Ai | null {
  if (cached !== undefined) return cached;
  const apiKey = process.env.DEMO_MODE === "1" ? undefined : readSecret("ANTHROPIC_API_KEY");
  cached = apiKey ? createAi({ apiKey, model: process.env.AI_MODEL }) : null;
  return cached;
}

async function settingsFor(db: Db, householdId: string) {
  return withHousehold(db, householdId, async (tx) => {
    const [h] = await tx
      .select({ ai: schema.households.ai, notifications: schema.households.notifications })
      .from(schema.households)
      .where(eq(schema.households.id, householdId));
    return { ai: parseAiSettings(h?.ai), notify: parseNotifySettings(h?.notifications) };
  });
}

/** After a sync: suggest categories for the new, still-uncategorized rows. Never throws. */
export async function aiAfterSync(
  db: Db,
  householdId: string,
  since: Date,
  ai: Ai | null = workerAi(),
): Promise<void> {
  if (!ai) return;
  try {
    const { ai: s } = await settingsFor(db, householdId);
    if (!s.categorize) return;
    const r = await categorizeUncategorized(db, householdId, ai, { since, limit: 300 });
    if (r.considered) log.info({ householdId, ...r }, "ai: categorized");
  } catch (e) {
    log.warn({ householdId, err: (e as Error).message }, "ai: categorization skipped");
  }
}

/** Households that opted in to the weekly digest (ids only, via SECURITY DEFINER fn). */
export async function digestHouseholds(db: Db): Promise<string[]> {
  const { rows } = await db.execute<{ id: string }>(sql`select digest_households() as id`);
  return rows.map((r) => r.id);
}

/** Write and deliver one household's digest. Throws on failure so the job can be retried. */
export async function weeklyDigestFor(
  db: Db,
  householdId: string,
  ai: Ai | null = workerAi(),
  opts: { fetch?: typeof fetch } = {},
): Promise<boolean> {
  if (!ai) return false;
  let digest: Awaited<ReturnType<typeof generateWeeklyDigest>>;
  try {
    digest = await generateWeeklyDigest(db, householdId, ai);
  } catch (e) {
    if (!(e instanceof AiBudgetError)) throw e;
    log.info({ householdId }, "digest: skipped, monthly AI token limit reached");
    return false;
  }
  const { notify } = await settingsFor(db, householdId);
  if (notify.ntfyUrl) {
    await safeSendNtfy(
      notify,
      notify.includeAmounts === false
        ? {
            title: "Your weekly money digest is ready",
            body: "Open Money Manager to read it.",
            priority: "default",
          }
        : {
            title: digest.title,
            body: [digest.summary, ...digest.highlights.map((h) => `• ${h}`)].join("\n"),
            priority: "default",
          },
      opts.fetch,
    ).catch((e) => log.warn({ householdId, err: (e as Error).message }, "digest: push failed"));
  }
  return true;
}

/** Every opted-in household in one pass. The worker runs one job per household instead. */
export async function weeklyDigests(
  db: Db,
  ai: Ai | null = workerAi(),
  opts: { fetch?: typeof fetch } = {},
): Promise<number> {
  if (!ai) return 0;
  const ids = await digestHouseholds(db);
  let done = 0;
  for (const id of ids) {
    try {
      if (await weeklyDigestFor(db, id, ai, opts)) done++;
    } catch (e) {
      log.warn({ householdId: id, err: (e as Error).message }, "digest: failed");
    }
  }
  log.info({ households: ids.length, done }, "digest: weekly run");
  return done;
}
