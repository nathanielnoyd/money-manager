import type * as React from "react";
import { Logo } from "@/components/logo";
import { sourceUrl } from "@/lib/source";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-[radial-gradient(ellipse_at_top,var(--accent),transparent_60%)] px-4 py-12">
      <Logo className="mb-8 text-lg" />
      <div className="w-full max-w-sm">{children}</div>
      <p className="mt-10 text-center text-xs text-muted-foreground">
        Self-hosted · Your data stays on your server ·{" "}
        <a
          href={sourceUrl()}
          target="_blank"
          rel="noreferrer noopener"
          className="hover:text-foreground hover:underline"
        >
          Source code (AGPL-3.0)
        </a>
      </p>
    </div>
  );
}
