import { schema, withHousehold } from "@mm/db";
import { eq } from "drizzle-orm";
import { Card, CardContent } from "@/components/ui/card";
import { findValidInvite } from "@/lib/auth/invites";
import { db } from "@/lib/db";
import { InviteForm } from "./invite-form";

export const metadata = { title: "Join household" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await findValidInvite(db(), token);
  if (!invite) {
    return (
      <Card>
        <CardContent className="p-6">
          <h1 className="text-xl font-semibold tracking-tight">Invite not valid</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            This link was already used, revoked, or has expired. Ask the household owner for a new
            one.
          </p>
        </CardContent>
      </Card>
    );
  }
  const [household] = await withHousehold(db(), invite.household_id, (tx) =>
    tx
      .select({ name: schema.households.name })
      .from(schema.households)
      .where(eq(schema.households.id, invite.household_id)),
  );
  return (
    <InviteForm
      token={token}
      email={invite.email}
      role={invite.role}
      householdName={household?.name ?? "a household"}
    />
  );
}
