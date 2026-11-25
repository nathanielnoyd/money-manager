"use client";

import { Check, Copy, Download } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function RecoveryCodesView({ codes }: { codes: string[] }) {
  const [copied, setCopied] = useState(false);
  const text = `Money Manager recovery codes\nEach code can be used once.\n\n${codes.join("\n")}\n`;

  return (
    <div className="flex flex-col gap-3">
      <ol className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/50 p-4 font-mono text-sm">
        {codes.map((c) => (
          <li key={c} className="tabular">
            {c}
          </li>
        ))}
      </ol>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={async () => {
            await navigator.clipboard.writeText(text);
            setCopied(true);
          }}
        >
          {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
            const a = document.createElement("a");
            a.href = url;
            a.download = "money-manager-recovery-codes.txt";
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          <Download /> Download
        </Button>
      </div>
    </div>
  );
}
