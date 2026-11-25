import { hasAnyUser } from "@mm/db";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { DemoEnter } from "./demo-enter";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await getSession()) redirect("/");
  if (env().demoMode) return <DemoEnter />;
  if (!(await hasAnyUser(db()))) redirect("/setup");
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
