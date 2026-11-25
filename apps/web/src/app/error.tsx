"use client";

import { useEffect } from "react";

/** For the sign-in, setup and invite pages, which have no app shell. */
export default function RootError({
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
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        The server may be restarting or the database may be briefly unavailable. Nothing was
        changed.
      </p>
      {error.digest && (
        <p className="text-xs text-muted-foreground">
          Reference <span className="font-mono">{error.digest}</span>
        </p>
      )}
      <button
        type="button"
        onClick={reset}
        className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted"
      >
        Try again
      </button>
    </main>
  );
}
