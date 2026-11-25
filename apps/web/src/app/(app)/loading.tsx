/** Placeholder while a page's data loads. Sized like a page header and a few cards. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="mb-6 h-8 w-48 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
      <div className="grid gap-4 sm:grid-cols-3">
        {["a", "b", "c"].map((k) => (
          <div
            key={k}
            className="h-24 animate-pulse rounded-xl bg-muted motion-reduce:animate-none"
          />
        ))}
      </div>
      <div className="mt-4 h-72 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
    </div>
  );
}
