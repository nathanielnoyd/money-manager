import type { PgBoss, Queue } from "pg-boss";

/**
 * Create a queue with the given policy. pg-boss can't change the policy of an existing queue,
 * so one created by an earlier version is dropped and recreated. Jobs waiting in it are lost;
 * callers must be able to re-queue them (the sync scheduler does, every few minutes).
 */
export async function ensureQueue(
  boss: PgBoss,
  name: string,
  policy: NonNullable<Queue["policy"]> = "standard",
): Promise<void> {
  const existing = await boss.getQueue(name);
  if (existing && existing.policy !== policy) await boss.deleteQueue(name);
  if (!existing || existing.policy !== policy) await boss.createQueue(name, { policy });
}
