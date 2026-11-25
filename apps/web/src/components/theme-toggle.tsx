"use client";

import { Moon, Sun } from "lucide-react";
import { toggleTheme } from "@/lib/theme";

export function ThemeToggle() {
  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
      aria-label="Toggle theme"
      title="Toggle theme"
    >
      <Sun className="size-4 dark:hidden" />
      <Moon className="hidden size-4 dark:block" />
    </button>
  );
}
