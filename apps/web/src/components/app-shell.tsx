"use client";

import { LogOut, Menu, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type * as React from "react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { CommandPalette } from "./command-palette";
import { Logo } from "./logo";
import { NAV, type NavItem, SETTINGS_NAV } from "./nav";
import { ThemeToggle } from "./theme-toggle";

export function AppShell({
  user,
  sourceUrl,
  demo = false,
  children,
}: {
  user: { displayName: string; householdName: string; role: "owner" | "member" | "viewer" };
  sourceUrl: string;
  demo?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [paletteOpen, setPaletteOpen] = useState(false);
  // The drawer remembers which page it was opened on, so navigating closes it.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const mobileOpen = openedOn === pathname;
  const setMobileOpen = (open: boolean) => setOpenedOn(open ? pathname : null);

  useEffect(() => {
    let pendingG = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      if (e.key === "g") {
        pendingG = true;
        clearTimeout(timer);
        timer = setTimeout(() => (pendingG = false), 800);
        return;
      }
      if (pendingG) {
        pendingG = false;
        const target = NAV.find((n) => n.shortcut === `G ${e.key.toUpperCase()}`);
        if (target) router.push(target.href);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  const sidebar = (
    <nav className="flex h-full flex-col gap-1 p-3">
      <div className="flex items-center justify-between px-2 pb-4 pt-1">
        <Logo />
        <button
          type="button"
          className="rounded-md p-1 text-muted-foreground hover:bg-muted lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-label="Close menu"
        >
          <X className="size-5" />
        </button>
      </div>
      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        className="mb-3 flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm text-muted-foreground shadow-xs hover:bg-muted"
      >
        <Search className="size-4" />
        <span className="flex-1 text-left">Search…</span>
        <kbd className="rounded border bg-muted px-1.5 font-mono text-[10px]">⌘K</kbd>
      </button>
      {NAV.map((item) => (
        <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} />
      ))}
      <div className="mt-auto flex flex-col gap-1 border-t pt-3">
        <NavLink item={SETTINGS_NAV} active={isActive(pathname, SETTINGS_NAV.href)} />
        <div className="flex items-center gap-2 rounded-lg px-2 py-2">
          <div className="flex size-8 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
            {initials(user.displayName)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{user.displayName}</div>
            <div className="truncate text-xs text-muted-foreground">{user.householdName}</div>
          </div>
          <ThemeToggle />
          <button
            type="button"
            onClick={signOut}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
      <a
        href={sourceUrl}
        target="_blank"
        rel="noreferrer noopener"
        className="px-3 pt-1 text-[11px] text-muted-foreground/70 hover:text-muted-foreground"
      >
        Open source · AGPL-3.0
      </a>
    </nav>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="sticky top-0 hidden h-dvh border-r bg-muted/30 lg:block">{sidebar}</aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-black/30 backdrop-blur-[2px]"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-72 border-r bg-background shadow-xl">
            {sidebar}
          </aside>
        </div>
      )}

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur lg:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="rounded-md p-1.5 hover:bg-muted"
            aria-label="Open menu"
          >
            <Menu className="size-5" />
          </button>
          <Logo className="text-sm" />
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="ml-auto rounded-md p-1.5 hover:bg-muted"
            aria-label="Search"
          >
            <Search className="size-5" />
          </button>
        </header>
        {demo ? (
          <div className="border-b bg-accent px-4 py-2 text-center text-xs text-accent-foreground">
            You're exploring a demo with made-up data. It's read-only and resets nightly.{" "}
            <a
              href={sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="font-medium underline"
            >
              Self-host your own
            </a>
          </div>
        ) : (
          user.role === "viewer" && (
            <div className="border-b bg-muted/60 px-4 py-2 text-center text-xs text-muted-foreground">
              You have view-only access to this household.
            </div>
          )
        )}
        <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
          {children}
        </main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} onSignOut={signOut} />
    </div>
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={cn(
        "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
        active
          ? "bg-card font-medium text-foreground shadow-xs ring-1 ring-border"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <Icon className={cn("size-4", active && "text-primary")} />
      {item.label}
    </Link>
  );
}

const isActive = (pathname: string, href: string) =>
  href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
