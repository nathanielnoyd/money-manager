"use server";

import { type ActionResult, requireStepUp } from "@/lib/household";

/**
 * Confirms the caller is an owner with a recent passkey check, so the browser can then
 * fetch /api/export (which checks again). Returns nothing sensitive itself.
 */
export async function prepareExport(): Promise<ActionResult> {
  const s = await requireStepUp();
  if ("ok" in s) return s;
  return { ok: true };
}
