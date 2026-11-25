import type { AlertSettings } from "./alerts";

/** Household notification settings (stored as JSON on the household). */
export interface NotifySettings extends AlertSettings {
  /** ntfy topic URL, e.g. https://ntfy.sh/my-secret-topic or a self-hosted server. */
  ntfyUrl?: string;
  ntfyToken?: string;
}

export function parseNotifySettings(raw: unknown): NotifySettings {
  const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown) =>
    typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : undefined;
  const url =
    typeof s.ntfyUrl === "string" && /^https?:\/\/[^\s]+$/.test(s.ntfyUrl) ? s.ntfyUrl : undefined;
  return {
    ntfyUrl: url,
    ntfyToken: typeof s.ntfyToken === "string" && s.ntfyToken ? s.ntfyToken : undefined,
    largeTransaction: num(s.largeTransaction),
    lowBalance: num(s.lowBalance),
    priceIncreases: s.priceIncreases === true,
    syncProblems: s.syncProblems === true,
    budgetOverspend: s.budgetOverspend === true,
    rewardReminders: s.rewardReminders === true,
    includeAmounts: s.includeAmounts !== false,
  };
}

/** Deliver one message to ntfy (https://docs.ntfy.sh/publish/). */
export async function sendNtfy(
  s: Pick<NotifySettings, "ntfyUrl" | "ntfyToken">,
  msg: { title: string; body: string; priority: "default" | "high" },
  doFetch: typeof fetch = fetch,
): Promise<void> {
  if (!s.ntfyUrl) throw new Error("No ntfy URL configured");
  const res = await doFetch(s.ntfyUrl, {
    method: "POST",
    body: msg.body,
    headers: {
      Title: msg.title,
      Priority: msg.priority === "high" ? "4" : "3",
      Tags: "moneybag",
      ...(s.ntfyToken ? { Authorization: `Bearer ${s.ntfyToken}` } : {}),
    },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`ntfy responded ${res.status}`);
}
