"use client";

import { RotateCw, TriangleAlert } from "lucide-react";
import { useEffect } from "react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";

/** Shown inside the app shell when a page fails to load, so navigation still works. */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <EmptyState icon={TriangleAlert} title="This page couldn't be loaded">
      <p>
        Nothing was changed. The server may be restarting or the database may be briefly
        unavailable; try again in a moment.
      </p>
      {error.digest && (
        <p className="mt-2 text-xs">
          Reference <span className="font-mono">{error.digest}</span> (look for it in the web
          container's logs).
        </p>
      )}
      <Button variant="outline" className="mt-4" onClick={reset}>
        <RotateCw /> Try again
      </Button>
    </EmptyState>
  );
}
