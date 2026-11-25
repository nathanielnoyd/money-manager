"use server";

import {
  resetCatalogEntry,
  revertCatalogChange,
  reviewCatalogChange,
  setCardCredits,
  setCatalogApproval,
  setMerchantRewardCategory,
  setPointsBalance,
  setRewardCategory,
  setRewardValuation,
  setSignupBonus,
  setTransactionRewardCategory,
  setWalletCard,
  simulateCard,
} from "@mm/services";
import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { type ActionResult, runOperation } from "@/lib/household";

const refresh = () => {
  revalidatePath("/rewards");
  revalidatePath("/transactions");
};

async function run<I extends z.ZodType, O>(
  op: Parameters<typeof runOperation<I, O>>[0],
  input: z.input<I>,
): Promise<ActionResult> {
  const r = await runOperation(op, input);
  if (!r.ok) return r;
  refresh();
  return { ok: true };
}

export const saveWalletCard = async (input: z.input<typeof setWalletCard.input>) =>
  run(setWalletCard, input);
export const saveRewardCategory = async (input: z.input<typeof setRewardCategory.input>) =>
  run(setRewardCategory, input);
export const saveMerchantRewardCategory = async (
  input: z.input<typeof setMerchantRewardCategory.input>,
) => run(setMerchantRewardCategory, input);
export const saveTransactionRewardCategory = async (
  input: z.input<typeof setTransactionRewardCategory.input>,
) => run(setTransactionRewardCategory, input);
export const saveRewardValuation = async (input: z.input<typeof setRewardValuation.input>) =>
  run(setRewardValuation, input);

export const saveCardCredits = async (input: z.input<typeof setCardCredits.input>) =>
  run(setCardCredits, input);
export const saveSignupBonus = async (input: z.input<typeof setSignupBonus.input>) =>
  run(setSignupBonus, input);
export const savePointsBalance = async (input: z.input<typeof setPointsBalance.input>) =>
  run(setPointsBalance, input);

export const reviewCatalog = async (input: z.input<typeof reviewCatalogChange.input>) =>
  run(reviewCatalogChange, input);
export const undoCatalogChange = async (input: z.input<typeof revertCatalogChange.input>) =>
  run(revertCatalogChange, input);
export const resetCatalog = async (input: z.input<typeof resetCatalogEntry.input>) =>
  run(resetCatalogEntry, input);
export const saveCatalogApproval = async (input: z.input<typeof setCatalogApproval.input>) =>
  run(setCatalogApproval, input);

/** Read-only: what one catalog card would add to the wallet. */
export async function simulate(slug: string) {
  return runOperation(simulateCard, { slug });
}
