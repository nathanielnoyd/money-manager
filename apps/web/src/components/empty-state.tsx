import type { LucideIcon } from "lucide-react";
import type * as React from "react";

export function EmptyState({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed bg-card/50 px-6 py-16 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <Icon className="size-5" />
      </div>
      <h3 className="text-base font-semibold">{title}</h3>
      <div className="mt-1 max-w-md text-sm text-muted-foreground">{children}</div>
    </div>
  );
}
