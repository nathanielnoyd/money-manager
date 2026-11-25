"use client";

import { Eye, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/lib/client-api";

export function DemoEnter() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Try the live demo</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A year of made-up finances for a fictional household. Read-only, and reset every night.
            No sign-up and nothing to install.
          </p>
        </div>
        <Button
          size="lg"
          autoFocus
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await api("/api/demo/enter");
              router.replace("/");
              router.refresh();
            } catch (e) {
              setError((e as Error).message);
              setBusy(false);
            }
          }}
        >
          {busy ? <Loader2 className="animate-spin" /> : <Eye />} Explore the demo
        </Button>
        {error && (
          <p role="alert" className="text-sm text-negative">
            {error}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          To use it with your own accounts, self-host it: one Docker Compose file, free to run.
        </p>
      </CardContent>
    </Card>
  );
}
