"use client";

/**
 * Last resort: the root layout itself failed, so this replaces the whole document and can't
 * rely on the app's stylesheet or theme.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          display: "grid",
          placeItems: "center",
          minHeight: "100dvh",
          margin: 0,
          padding: 24,
          textAlign: "center",
        }}
      >
        <div>
          <h1 style={{ fontSize: 20 }}>Money Manager couldn't load</h1>
          <p style={{ color: "#666", maxWidth: 420 }}>
            The server may be restarting or the database may be unavailable. Nothing was changed.
            {error.digest ? ` Reference ${error.digest}.` : ""}
          </p>
          <button type="button" onClick={reset} style={{ padding: "8px 16px", fontSize: 14 }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
