import "server-only";
import type { NextResponse } from "next/server";
import { env } from "../env";
import { assertSameOrigin, jsonError } from "./request";
import { getSession, isFreshRecovery, isRecentlyAuthenticated, type Session } from "./session";

/** For authenticated JSON mutations: same-origin + session (+ optional recent passkey auth). */
export async function guard(
  req: Request,
  opts: { stepUp?: boolean; allowFreshRecovery?: boolean } = {},
): Promise<{ session: Session; error?: never } | { session?: never; error: NextResponse }> {
  const bad = assertSameOrigin(req);
  if (bad) return { error: bad };
  const session = await getSession();
  if (!session) return { error: jsonError("Not signed in", 401) };
  // The demo account is shared: nobody may add passkeys, TOTP or recovery codes to it.
  if (env().demoMode) return { error: jsonError("Not available in the demo.", 403) };
  if (
    opts.stepUp &&
    !isRecentlyAuthenticated(session) &&
    !(opts.allowFreshRecovery && isFreshRecovery(session))
  ) {
    return { error: jsonError("step_up_required", 403) };
  }
  return { session };
}
