import { Sparkles } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { householdAiSettings, serverAi } from "@/lib/ai";
import { hasRole, inHousehold } from "@/lib/household";
import { AskChat } from "./ask-chat";

export const metadata = { title: "Ask" };

export default async function AskPage() {
  const { settings, isOwner } = await inHousehold(async (tx, s) => ({
    settings: await householdAiSettings(tx, s.householdId),
    isOwner: hasRole(s, "owner"),
  }));
  const configured = !!serverAi();
  return (
    <>
      <PageHeader
        title="Ask"
        description="Questions about your money, answered from your own data."
      />
      {!configured || !settings.enabled ? (
        <EmptyState icon={Sparkles} title={configured ? "AI is turned off" : "AI isn't set up"}>
          {configured ? (
            isOwner ? (
              <>
                Turn it on in{" "}
                <Link href="/settings/ai" className="text-primary hover:underline">
                  Settings → AI
                </Link>
                . You'll see exactly what gets shared first.
              </>
            ) : (
              "Ask the household owner to turn it on in Settings → AI."
            )
          ) : (
            "Add an Anthropic API key to the server (ANTHROPIC_API_KEY) to enable optional AI features. See docs/self-hosting.md."
          )}
        </EmptyState>
      ) : (
        <AskChat />
      )}
    </>
  );
}
