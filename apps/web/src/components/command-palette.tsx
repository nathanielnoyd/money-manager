"use client";

import { Command } from "cmdk";
import { LogOut, Moon, Shield } from "lucide-react";
import { useRouter } from "next/navigation";
import { toggleTheme } from "@/lib/theme";
import { NAV, SETTINGS_NAV } from "./nav";

export function CommandPalette({
  open,
  onOpenChange,
  onSignOut,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSignOut: () => void;
}) {
  const router = useRouter();
  const run = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Command menu"
      overlayClassName="fixed inset-0 z-50 bg-black/30 backdrop-blur-[2px]"
      contentClassName="fixed left-1/2 top-[15vh] z-50 w-[92vw] max-w-lg -translate-x-1/2 overflow-hidden rounded-xl border bg-card shadow-2xl"
    >
      <Command.Input
        placeholder="Jump to a page or run a command…"
        className="h-12 w-full border-b bg-transparent px-4 text-sm outline-none placeholder:text-muted-foreground"
      />
      <Command.List className="max-h-80 overflow-y-auto p-2">
        <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">
          No results.
        </Command.Empty>
        <Command.Group
          heading="Go to"
          className="text-xs text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
        >
          {[...NAV, SETTINGS_NAV].map((item) => (
            <Item key={item.href} onSelect={() => run(() => router.push(item.href))}>
              <item.icon className="size-4" />
              {item.label}
              {item.shortcut && (
                <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                  {item.shortcut}
                </span>
              )}
            </Item>
          ))}
        </Command.Group>
        <Command.Group
          heading="Actions"
          className="text-xs text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
        >
          <Item onSelect={() => run(toggleTheme)}>
            <Moon className="size-4" /> Toggle dark mode
          </Item>
          <Item onSelect={() => run(() => router.push("/settings/security"))}>
            <Shield className="size-4" /> Security settings
          </Item>
          <Item onSelect={() => run(onSignOut)}>
            <LogOut className="size-4" /> Sign out
          </Item>
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}

function Item({ children, onSelect }: { children: React.ReactNode; onSelect: () => void }) {
  return (
    <Command.Item
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm text-foreground data-[selected=true]:bg-muted"
    >
      {children}
    </Command.Item>
  );
}
