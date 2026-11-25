import {
  ArrowLeftRight,
  CreditCard,
  Goal,
  LayoutDashboard,
  type LucideIcon,
  PiggyBank,
  Repeat,
  Settings,
  Sparkles,
  TrendingUp,
  Wallet,
  Waves,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  shortcut?: string;
}

export const NAV: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, shortcut: "G D" },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight, shortcut: "G T" },
  { href: "/accounts", label: "Accounts", icon: Wallet, shortcut: "G A" },
  { href: "/budget", label: "Budget", icon: PiggyBank, shortcut: "G B" },
  { href: "/cash-flow", label: "Cash flow", icon: Waves },
  { href: "/recurring", label: "Recurring", icon: Repeat },
  { href: "/goals", label: "Goals", icon: Goal },
  { href: "/investments", label: "Investments", icon: TrendingUp },
  { href: "/rewards", label: "Rewards", icon: CreditCard },
  { href: "/ask", label: "Ask", icon: Sparkles },
];

export const SETTINGS_NAV: NavItem = { href: "/settings", label: "Settings", icon: Settings };
