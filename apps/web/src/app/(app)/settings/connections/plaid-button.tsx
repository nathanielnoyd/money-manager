"use client";

import { Building2, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { passkeyErrorMessage } from "@/lib/client-api";
import { openPlaidLink } from "@/lib/plaid-link";
import { actionWithStepUp } from "@/lib/step-up";
import { addPlaid, plaidLinkToken } from "./actions";

export function PlaidButton() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            try {
              const t = await actionWithStepUp(() => plaidLinkToken());
              if (!t.ok) return setError(t.error ?? "Couldn't start Plaid.");
              const result = await openPlaidLink(t.data?.linkToken as string);
              if (!result) return;
              const r = await actionWithStepUp(() => addPlaid(result));
              if (!r.ok) setError(r.error ?? "Couldn't save the connection.");
            } catch (e) {
              setError(passkeyErrorMessage(e));
            }
          })
        }
      >
        {pending ? <Loader2 className="animate-spin" /> : <Building2 />} Connect with Plaid
      </Button>
      {error && (
        <p role="alert" className="max-w-sm text-right text-sm text-negative">
          {error}
        </p>
      )}
    </div>
  );
}
