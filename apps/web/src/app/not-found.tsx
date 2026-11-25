import Link from "next/link";

/** For addresses outside the signed-in app (which has its own not-found page). */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-xl font-semibold">That page doesn't exist</h1>
      <p className="text-sm text-muted-foreground">The link may be wrong or out of date.</p>
      <Link href="/" className="text-sm text-primary hover:underline">
        Go to Money Manager
      </Link>
    </main>
  );
}
