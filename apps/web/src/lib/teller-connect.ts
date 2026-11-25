"use client";

/**
 * Minimal Teller Connect loader (https://teller.io/docs/guides/connect). A third-party
 * script, loaded only on a click: see the note in plaid-link.ts.
 */
interface TellerEnrollment {
  accessToken: string;
  enrollment?: { institution?: { name?: string } };
}
interface TellerGlobal {
  setup: (cfg: {
    applicationId: string;
    environment: string;
    products: string[];
    onSuccess: (e: TellerEnrollment) => void;
    onExit?: () => void;
  }) => { open: () => void };
}

let loading: Promise<TellerGlobal> | undefined;
function load(): Promise<TellerGlobal> {
  const w = window as unknown as { TellerConnect?: TellerGlobal };
  if (w.TellerConnect) return Promise.resolve(w.TellerConnect);
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.teller.io/connect/connect.js";
    s.async = true;
    s.onload = () =>
      w.TellerConnect
        ? resolve(w.TellerConnect)
        : reject(new Error("Teller Connect failed to load"));
    s.onerror = () => reject(new Error("Couldn't load Teller Connect. Check content blockers."));
    document.head.appendChild(s);
  });
  return loading;
}

export async function openTellerConnect(applicationId: string, environment: string) {
  const Teller = await load();
  return new Promise<{ accessToken: string; institutionName?: string } | null>((resolve) => {
    Teller.setup({
      applicationId,
      environment,
      products: ["transactions", "balance"],
      onSuccess: (e) =>
        resolve({ accessToken: e.accessToken, institutionName: e.enrollment?.institution?.name }),
      onExit: () => resolve(null),
    }).open();
  });
}
