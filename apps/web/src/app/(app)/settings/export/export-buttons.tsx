"use client";

import { Download, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { actionWithStepUp } from "@/lib/step-up";
import { prepareExport } from "./actions";

export function ExportButtons() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const download = (format: "csv" | "json") =>
    start(async () => {
      setError(null);
      try {
        const r = await actionWithStepUp(() => prepareExport());
        if (!r.ok) return setError(r.error ?? "Couldn't start the export.");
        window.location.assign(`/api/export?format=${format}`);
      } catch {
        setError("The passkey check didn't complete. Try again.");
      }
    });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={pending} onClick={() => download("csv")}>
          {pending ? <Loader2 className="animate-spin" /> : <Download />} Transactions (CSV)
        </Button>
        <Button variant="outline" disabled={pending} onClick={() => download("json")}>
          {pending ? <Loader2 className="animate-spin" /> : <Download />} Everything (JSON)
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}
    </div>
  );
}
