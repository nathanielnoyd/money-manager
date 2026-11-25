import { parseNotifySettings } from "@mm/core";
import { schema } from "@mm/db";
import { eq } from "drizzle-orm";
import { PageHeader } from "@/components/page-header";
import { hasRole, inHousehold } from "@/lib/household";
import { NotificationsForm } from "./notifications-form";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const { settings, isOwner } = await inHousehold(async (tx, s) => {
    const [h] = await tx
      .select({ n: schema.households.notifications })
      .from(schema.households)
      .where(eq(schema.households.id, s.householdId));
    return { settings: parseNotifySettings(h?.n), isOwner: hasRole(s, "owner") };
  });
  return (
    <>
      <PageHeader
        title="Notifications"
        description="Push alerts to your phone through ntfy, after each sync."
      />
      {/* The token itself never goes to the browser. */}
      <NotificationsForm
        settings={{ ...settings, ntfyToken: undefined }}
        hasToken={!!settings.ntfyToken}
        canEdit={isOwner}
      />
    </>
  );
}
