"use client";

import { X } from "lucide-react";
import { Dialog as D } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({
  title,
  description,
  className,
  children,
  side = "center",
}: {
  title: string;
  description?: string;
  className?: string;
  children: React.ReactNode;
  side?: "center" | "right";
}) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[2px]" />
      <D.Content
        className={cn(
          "fixed z-50 flex flex-col border bg-card shadow-2xl outline-none",
          side === "center" &&
            "left-1/2 top-1/2 max-h-[90dvh] w-[94vw] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl",
          side === "right" && "inset-y-0 right-0 w-full max-w-md border-y-0 border-r-0",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b p-5">
          <div>
            <D.Title className="text-base font-semibold">{title}</D.Title>
            {description ? (
              <D.Description className="mt-1 text-sm text-muted-foreground">
                {description}
              </D.Description>
            ) : (
              <D.Description className="sr-only">{title}</D.Description>
            )}
          </div>
          <D.Close
            className="rounded-md p-1 text-muted-foreground hover:bg-muted"
            aria-label="Close"
          >
            <X className="size-4" />
          </D.Close>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
      </D.Content>
    </D.Portal>
  );
}
