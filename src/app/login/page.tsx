import { redirect } from "next/navigation";
import { getCurrentStaff, homeFor, signIn } from "@/lib/auth";
import type { ActionState } from "@/lib/action-state";
import { ActionForm } from "@/components/action-form";
import { Brand } from "@/components/brand";
import { Card, Field, Input } from "@/components/ui";

async function login(_: ActionState, formData: FormData): Promise<ActionState> {
  "use server";
  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!(await signIn(username, password))) {
    return { error: "Wrong username or password." };
  }
  const user = await getCurrentStaff();
  redirect(user ? homeFor(user) : "/");
}

export default async function LoginPage() {
  const user = await getCurrentStaff();
  if (user) redirect(homeFor(user));
  return (
    <main className="flex flex-1 items-center justify-center bg-sidebar p-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-2 flex justify-center text-4xl text-sidebar-foreground">
          <Brand />
        </h1>
        <p className="mb-6 text-center text-sm text-sidebar-muted">For staff and residents</p>
        <Card className="border-0 border-t-4 border-t-brand p-6 shadow-xl sm:p-7">
          <ActionForm action={login} submitLabel="Sign in" pendingLabel="Signing in…">
            <Field label="Username">
              <Input name="username" autoComplete="username" autoCapitalize="none" autoCorrect="off" required />
            </Field>
            <Field label="Password">
              <Input name="password" type="password" autoComplete="current-password" required />
            </Field>
          </ActionForm>
        </Card>
        <p className="mt-4 text-center text-xs text-sidebar-muted">Forgot your password? Ask the front desk to reset it.</p>
      </div>
    </main>
  );
}
