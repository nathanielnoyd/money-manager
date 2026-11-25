import type * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "flex h-10 w-full rounded-lg border border-input bg-card px-3 text-sm shadow-xs transition-colors placeholder:text-muted-foreground/70 focus-visible:border-primary disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: React.ComponentProps<"label">) {
  // biome-ignore lint/a11y/noLabelWithoutControl: consumers pass htmlFor
  return <label className={cn("text-sm font-medium", className)} {...props} />;
}
