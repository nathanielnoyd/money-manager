"use server";

import { withHousehold } from "@mm/db";
import {
  type CreateTokenInput,
  createApiToken,
  OperationError,
  revokeApiToken,
} from "@mm/services";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/auth/audit";
import { requireSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { type ActionResult, requireStepUp } from "@/lib/household";

const refresh = () => revalidatePath("/settings/agents");

/**
 * Create an agent token. Needs a passkey check in the last 15 minutes. The token is
 * returned once and never stored in readable form.
 */
export async function createAgentToken(
  input: z.input<typeof CreateTokenInput>,
): Promise<ActionResult<{ token: string; expiresAt: string }>> {
  if (env().demoMode) return { ok: false, error: "Not available in the demo." };
  const s = await requireStepUp("viewer");
  if ("ok" in s) return s;
  try {
    const r = await withHousehold(db(), s.householdId, (tx) => createApiToken(tx, s, input));
    await audit({
      action: "agent_token.created",
      userId: s.userId,
      householdId: s.householdId,
      detail: { tokenId: r.id, name: input.name, scopes: input.scopes },
    });
    refresh();
    return { ok: true, data: { token: r.token, expiresAt: r.expiresAt.toISOString() } };
  } catch (e) {
    if (e instanceof OperationError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function revokeAgentToken(id: string): Promise<ActionResult> {
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "Invalid token." };
  const s = await requireSession();
  const ok = await withHousehold(db(), s.householdId, (tx) => revokeApiToken(tx, s, id));
  if (!ok) return { ok: false, error: "That token doesn't exist." };
  await audit({
    action: "agent_token.revoked",
    userId: s.userId,
    householdId: s.householdId,
    detail: { tokenId: id },
  });
  refresh();
  return { ok: true };
}
