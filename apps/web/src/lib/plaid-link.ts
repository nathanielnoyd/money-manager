"use client";

/**
 * Minimal Plaid Link loader (no npm dependency). The script comes from Plaid's CDN and
 * runs Link inside its own iframe; CSP allows that frame only when Plaid is configured.
 *
 * This and teller-connect.ts are the only third-party scripts in the app (AGENTS.md,
 * invariant 6). The script is requested only when someone clicks Connect, never on page
 * load, but it then runs in this origin. Keep it that way: don't preload it, and don't call
 * loadPlaid() from anything but a click. docs/security.md describes the trust involved.
 */

interface PlaidHandler {
  open: () => void;
  destroy: () => void;
}
interface PlaidMetadata {
  institution?: { name?: string } | null;
}
interface PlaidGlobal {
  create: (cfg: {
    token: string;
    receivedRedirectUri?: string;
    onSuccess: (publicToken: string, metadata: PlaidMetadata) => void;
    onExit: (err: { display_message?: string; error_message?: string } | null) => void;
  }) => PlaidHandler;
}

const SRC = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
const TOKEN_KEY = "mm-plaid-link-token";
let loading: Promise<PlaidGlobal> | undefined;

function loadPlaid(): Promise<PlaidGlobal> {
  const w = window as unknown as { Plaid?: PlaidGlobal };
  if (w.Plaid) return Promise.resolve(w.Plaid);
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SRC;
    s.async = true;
    s.onload = () => (w.Plaid ? resolve(w.Plaid) : reject(new Error("Plaid Link failed to load")));
    s.onerror = () =>
      reject(new Error("Couldn't load Plaid Link. Check your connection or content blockers."));
    document.head.appendChild(s);
  });
  return loading;
}

export interface PlaidResult {
  publicToken: string;
  institutionName?: string;
}

/** Open Plaid Link. Resolves with the public token, or null if the user closed it. */
export async function openPlaidLink(
  linkToken: string,
  receivedRedirectUri?: string,
): Promise<PlaidResult | null> {
  const Plaid = await loadPlaid();
  try {
    sessionStorage.setItem(TOKEN_KEY, linkToken); // needed to resume after an OAuth bank redirect
  } catch {
    // storage unavailable; OAuth resume won't work but Link itself still does
  }
  return new Promise((resolve, reject) => {
    const handler = Plaid.create({
      token: linkToken,
      receivedRedirectUri,
      onSuccess: (publicToken, metadata) => {
        handler.destroy();
        resolve({ publicToken, institutionName: metadata.institution?.name ?? undefined });
      },
      onExit: (err) => {
        handler.destroy();
        if (err)
          reject(
            new Error(
              err.display_message || err.error_message || "Plaid Link closed with an error.",
            ),
          );
        else resolve(null);
      },
    });
    handler.open();
  });
}

export function storedLinkToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
