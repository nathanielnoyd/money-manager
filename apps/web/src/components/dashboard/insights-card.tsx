"use client";

import { Lightbulb, Loader2, Sparkles } from "lucide-react";
import { useState, useTransition } from "react";
import { generateDigestNow } from "@/app/(app)/insights-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { InsightsData } from "@/lib/insights";

export function InsightsCard({ data }: { data: InsightsData }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!data.digest && data.anomalies.length === 0 && !data.canGenerate) return null;

  return (
    <Card className="mb-4 border-primary/20 bg-gradient-to-br from-accent/60 to-card">
      <CardContent className="flex flex-col gap-3 p-5">
        {data.digest ? (
          <div>
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-primary">
              <Sparkles className="size-3.5" /> Week of{" "}
              {new Date(`${data.digest.periodStart}T00:00:00Z`).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                timeZone: "UTC",
              })}
            </div>
            <h2 className="mt-1 text-lg font-semibold tracking-tight">{data.digest.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{data.digest.summary}</p>
            {data.digest.highlights.length > 0 && (
              <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
                {data.digest.highlights.map((h) => (
                  <li key={h} className="flex gap-2">
                    <span className="mt-2 size-1 shrink-0 rounded-full bg-primary" />
                    {h}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
        {data.anomalies.length > 0 && (
          <div className={data.digest ? "border-t pt-3" : undefined}>
            <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Lightbulb className="size-3.5" /> Worth a look
            </div>
            <ul className="space-y-1 text-sm">
              {data.anomalies.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </div>
        )}
        {data.canGenerate && (
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setError(null);
                  const r = await generateDigestNow();
                  if (!r.ok) setError(r.error);
                })
              }
            >
              {pending ? <Loader2 className="animate-spin" /> : <Sparkles />}{" "}
              {data.digest ? "Refresh this week's digest" : "Write this week's digest"}
            </Button>
            {error && <span className="text-sm text-negative">{error}</span>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
