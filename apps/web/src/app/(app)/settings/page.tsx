import {
  Bell,
  Bot,
  ChevronRight,
  Download,
  Link2,
  Shield,
  Sparkles,
  Tags,
  Users,
  Wand2,
} from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";

export const metadata = { title: "Settings" };

const ITEMS = [
  {
    href: "/settings/security",
    icon: Shield,
    title: "Security",
    body: "Passkeys, authenticator app, recovery codes and sessions.",
  },
  {
    href: "/settings/connections",
    icon: Link2,
    title: "Connections",
    body: "Link banks through SimpleFIN, Plaid or Teller, and see when each last synced.",
  },
  {
    href: "/settings/categories",
    icon: Tags,
    title: "Categories",
    body: "Organize spending into groups and categories.",
  },
  {
    href: "/settings/rules",
    icon: Wand2,
    title: "Rules",
    body: "Automatically categorize and rename transactions.",
  },
  {
    href: "/settings/notifications",
    icon: Bell,
    title: "Notifications",
    body: "Push alerts for large transactions, low balances, price increases and more.",
  },
  {
    href: "/settings/ai",
    icon: Sparkles,
    title: "AI",
    body: "Optional Claude features: Ask, smart categorization and a weekly digest.",
  },
  {
    href: "/settings/agents",
    icon: Bot,
    title: "Agents",
    body: "Tokens that let an AI agent work with your data through the MCP server.",
  },
  {
    href: "/settings/household",
    icon: Users,
    title: "Household",
    body: "Members, invites, roles and budgeting style.",
  },
  {
    href: "/settings/export",
    icon: Download,
    title: "Export",
    body: "Download your transactions as CSV, or everything as JSON.",
  },
] as const;

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" />
      <Card className="divide-y">
        {ITEMS.map((item) => (
          <Link
            key={item.title}
            href={item.href}
            className="flex items-center gap-4 p-5 hover:bg-muted/50"
          >
            <div className="flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
              <item.icon className="size-5" />
            </div>
            <div className="flex-1">
              <div className="font-medium">{item.title}</div>
              <div className="text-sm text-muted-foreground">{item.body}</div>
            </div>
            <ChevronRight className="size-4 text-muted-foreground" />
          </Link>
        ))}
      </Card>
    </>
  );
}
