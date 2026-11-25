"use server";

import { checkOutboundUrl, safeSendNtfy } from "@mm/connectors";
import { parseNotifySettings } from "@mm/core";
import { schema } from "@mm/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/auth/audit";
import { type ActionResult, denyUnless, inHousehold, requireStepUp } from "@/lib/household";

const Settings = z.object({
  ntfyUrl: z.union([z.literal(""), z.url({ protocol: /^https?$/ }).max(500)]),
  /** null = keep the saved token unchanged; "" = remove it. */
  ntfyToken: z.string().max(200).nullable(),
  largeTransaction: z.number().int().min(0).nullable(),
  lowBalance: z.number().int().min(0).nullable(),
  priceIncreases: z.boolean(),
  syncProblems: z.boolean(),
  budgetOverspend: z.boolean(),
  rewardReminders: z.boolean().default(false),
  includeAmounts: z.boolean(),
});

export type NotificationInput = z.input<typeof Settings>;

/**
 * Changing where alerts go can leak a household's activity, so it needs the owner plus a
 * fresh passkey check (not just a session cookie), and the URL must pass the SSRF guard.
 */
export async function saveNotifications(input: NotificationInput): Promise<ActionResult> {
  const s = await requireStepUp();
  if ("ok" in s) return s;
  const p = Settings.safeParse(input);
  if (!p.success) return { ok: false, error: "Enter an https ntfy topic URL." };
  const v = p.data;
  if (v.ntfyUrl) {
    const problem = await checkOutboundUrl(v.ntfyUrl);
    if (problem) return { ok: false, error: problem };
  }
  const existing = await inHousehold(async (tx) => {
    const [h] = await tx
      .select({ n: schema.households.notifications })
      .from(schema.households)
      .where(eq(schema.households.id, s.householdId));
    return parseNotifySettings(h?.n);
  });
  const token = v.ntfyToken === null ? existing.ntfyToken : v.ntfyToken;
  const stored = {
    ...(v.ntfyUrl ? { ntfyUrl: v.ntfyUrl } : {}),
    ...(token ? { ntfyToken: token } : {}),
    ...(v.largeTransaction ? { largeTransaction: v.largeTransaction } : {}),
    ...(v.lowBalance ? { lowBalance: v.lowBalance } : {}),
    priceIncreases: v.priceIncreases,
    syncProblems: v.syncProblems,
    budgetOverspend: v.budgetOverspend,
    rewardReminders: v.rewardReminders,
    includeAmounts: v.includeAmounts,
  };
  await inHousehold(async (tx) => {
    await tx
      .update(schema.households)
      .set({ notifications: stored })
      .where(eq(schema.households.id, s.householdId));
  });
  const moved = !!existing.ntfyUrl && existing.ntfyUrl !== v.ntfyUrl;
  await audit({
    action: "notifications.updated",
    userId: s.userId,
    householdId: s.householdId,
    detail: { destinationChanged: moved },
  });
  if (moved) {
    // Tell the previous destination, so a hijacked redirect doesn't go unnoticed.
    await safeSendNtfy(existing, {
      title: "Money Manager alerts moved",
      body: "This household's alerts now go to a different destination. If you didn't change this, sign in and review Settings → Security.",
      priority: "high",
    }).catch(() => {});
  }
  revalidatePath("/settings/notifications");
  return { ok: true };
}

export async function sendTestNotification(): Promise<ActionResult> {
  const denied = await denyUnless("owner");
  if (denied) return denied;
  const settings = await inHousehold(async (tx, s) => {
    const [h] = await tx
      .select({ n: schema.households.notifications })
      .from(schema.households)
      .where(eq(schema.households.id, s.householdId));
    return parseNotifySettings(h?.n);
  });
  if (!settings.ntfyUrl) return { ok: false, error: "Save an ntfy topic URL first." };
  try {
    await safeSendNtfy(settings, {
      title: "Money Manager",
      body: "Test notification: alerts are working.",
      priority: "default",
    });
    return { ok: true };
  } catch {
    // Deliberately generic: detailed network errors would turn this into a port scanner.
    return {
      ok: false,
      error: "Couldn't reach ntfy. Check the topic URL and that the server is reachable.",
    };
  }
}
