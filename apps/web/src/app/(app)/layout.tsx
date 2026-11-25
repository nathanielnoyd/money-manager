import type * as React from "react";
import { AppShell } from "@/components/app-shell";
import { requireSession } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { sourceUrl } from "@/lib/source";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await requireSession();
  return (
    <AppShell
      user={{ displayName: s.displayName, householdName: s.householdName, role: s.role }}
      sourceUrl={sourceUrl()}
      demo={env().demoMode}
    >
      {children}
    </AppShell>
  );
}
