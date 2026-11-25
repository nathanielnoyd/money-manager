"use client";

import { Landmark, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { passkeyErrorMessage } from "@/lib/client-api";
import { actionWithStepUp } from "@/lib/step-up";
import { openTellerConnect } from "@/lib/teller-connect";
import { addTeller } from "./actions";

export function TellerButton({
  applicationId,
  environment,
}: {
  applicationId: string;
  environment: string;
}) {
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
              const result = await openTellerConnect(applicationId, environment);
              if (!result) return;
              const r = await actionWithStepUp(() => addTeller(result));
              if (!r.ok) setError(r.error ?? "Couldn't save the connection.");
            } catch (e) {
              setError(passkeyErrorMessage(e));
            }
          })
        }
      >
        {pending ? <Loader2 className="animate-spin" /> : <Landmark />} Connect with Teller
      </Button>
      {error && (
        <p role="alert" className="max-w-sm text-right text-sm text-negative">
          {error}
        </p>
      )}
    </div>
  );
}
