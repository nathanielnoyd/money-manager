"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { openPlaidLink, storedLinkToken } from "@/lib/plaid-link";
import { actionWithStepUp } from "@/lib/step-up";
import { addPlaid } from "../actions";

/** Banks that use OAuth (Chase, Capital One, …) send the user back here to finish Plaid Link. */
export default function PlaidOAuthReturn() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = storedLinkToken();
    if (!token) {
      setError(
        "This Plaid session expired. Start the connection again from Settings → Connections.",
      );
      return;
    }
    openPlaidLink(token, window.location.href)
      .then(async (result) => {
        if (result) {
          const r = await actionWithStepUp(() => addPlaid(result));
          if (!r.ok) return setError(r.error ?? "Couldn't save the connection.");
        }
        router.replace("/settings/connections");
      })
      .catch((e: Error) => setError(e.message));
  }, [router]);

  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
      {error ? (
        <p className="text-negative">{error}</p>
      ) : (
        <>
          <Loader2 className="size-5 animate-spin" /> Finishing your bank connection…
        </>
      )}
    </div>
  );
}
