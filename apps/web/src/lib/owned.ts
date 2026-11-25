import "server-only";

/** See @mm/services util.ts: confirm client-supplied ids belong to the caller's household. */
export { ownsAll } from "@mm/services";

export const NOT_FOUND = { ok: false as const, error: "That item doesn't exist." };
