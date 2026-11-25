import type { LucideIcon } from "lucide-react";
import { EmptyState } from "./empty-state";
import { PageHeader } from "./page-header";

export function ComingSoon({
  title,
  icon,
  phase,
  children,
}: {
  title: string;
  icon: LucideIcon;
  phase: number;
  children: React.ReactNode;
}) {
  return (
    <>
      <PageHeader title={title} />
      <EmptyState icon={icon} title={`Coming in Phase ${phase}`}>
        {children}
      </EmptyState>
    </>
  );
}
