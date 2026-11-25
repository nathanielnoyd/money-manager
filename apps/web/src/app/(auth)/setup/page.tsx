import { hasAnyUser } from "@mm/db";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { SetupForm } from "./setup-form";

export const metadata = { title: "Set up" };

export default async function SetupPage() {
  if (env().demoMode || (await hasAnyUser(db()))) redirect("/login");
  return <SetupForm />;
}
