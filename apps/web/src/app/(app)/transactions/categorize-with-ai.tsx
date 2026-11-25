"use client";

import { Loader2, Sparkles } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { categorizeWithAi } from "./actions";

export function CategorizeWithAi({ count }: { count: number }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border bg-accent/40 p-3 text-sm">
      <Sparkles className="size-4 text-primary" />
      <span className="flex-1">
        {count} uncategorized. Claude can suggest categories from each description and amount;
        suggestions are marked <strong>AI</strong> for you to confirm.
      </span>
      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setMsg(null);
            const r = await categorizeWithAi();
            setMsg(
              r.ok
                ? `Categorized ${r.data?.applied ?? 0} of ${r.data?.considered ?? 0}. The rest need you.`
                : r.error,
            );
          })
        }
      >
        {pending ? <Loader2 className="animate-spin" /> : <Sparkles />} Categorize with AI
      </Button>
      {msg && (
        <p role="status" className="w-full text-muted-foreground">
          {msg}
        </p>
      )}
    </div>
  );
}
