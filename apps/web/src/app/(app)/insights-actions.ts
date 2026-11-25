"use server";

import { AiBudgetError, generateWeeklyDigest } from "@mm/ai";
import { withHousehold } from "@mm/db";
import { revalidatePath } from "next/cache";
import { AI_BUDGET_MESSAGE, aiRateLimit, householdAiSettings, serverAi } from "@/lib/ai";
import { requireSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { type ActionResult, denyUnless } from "@/lib/household";

export async function generateDigestNow(): Promise<ActionResult> {
  const denied = await denyUnless("member");
  if (denied) return denied;
  const s = await requireSession();
  const ai = serverAi();
  if (!ai) return { ok: false, error: "AI isn't configured on this server." };
  const settings = await withHousehold(db(), s.householdId, (tx) =>
    householdAiSettings(tx, s.householdId),
  );
  if (!settings.enabled)
    return { ok: false, error: "AI features are turned off for this household." };
  if (!aiRateLimit(s.householdId)) return { ok: false, error: "Too many AI requests this hour." };
  try {
    await generateWeeklyDigest(db(), s.householdId, ai);
  } catch (e) {
    if (e instanceof AiBudgetError) return { ok: false, error: AI_BUDGET_MESSAGE };
    console.error("digest failed", (e as Error).message);
    return { ok: false, error: "Couldn't write the digest right now. Try again shortly." };
  }
  revalidatePath("/");
  return { ok: true };
}
