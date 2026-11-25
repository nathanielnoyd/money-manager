"use client";

import { startAuthentication } from "@simplewebauthn/browser";
import { ApiError, api } from "./client-api";

const STEP_UP = "step_up_required";

async function reauthenticate() {
  const optionsJSON =
    await api<Parameters<typeof startAuthentication>[0]["optionsJSON"]>("/api/auth/login/options");
  await api("/api/auth/login/verify", await startAuthentication({ optionsJSON }));
}

/** Run a sensitive API call; if the server wants a fresh passkey check, do it and retry once. */
export async function withStepUp<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!(e instanceof ApiError && e.message === STEP_UP)) throw e;
    await reauthenticate();
    return fn();
  }
}

/** Same, for server actions that return `{ ok: false, error: "step_up_required" }`. */
export async function actionWithStepUp<R extends { ok: boolean; error?: string }>(
  fn: () => Promise<R>,
): Promise<R> {
  const first = await fn();
  if (first.ok || first.error !== STEP_UP) return first;
  await reauthenticate();
  return fn();
}
