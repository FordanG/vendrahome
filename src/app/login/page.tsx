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
    return { error: "Unable to sign in. Check your username and password. After repeated attempts, wait 15 minutes." };
  }
  const user = await getCurrentStaff();
  redirect(user ? afterSignIn(formData.get("next"), user) : "/");
}

// Only a door-code address comes back after signing in; anything else could send people off-site.
function afterSignIn(next: FormDataEntryValue | string | string[] | null | undefined, user: Parameters<typeof homeFor>[0]) {
  return typeof next === "string" && /^\/r\/[\w-]+$/.test(next) ? next : homeFor(user);
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  const user = await getCurrentStaff();
  if (user) redirect(afterSignIn(next, user));
  return (
    <main className="flex flex-1 items-center justify-center bg-sidebar p-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-2 flex justify-center text-4xl text-sidebar-foreground">
          <Brand />
        </h1>
        <p className="mb-6 text-center text-sm text-sidebar-muted">For staff and residents</p>
        <Card className="border-0 border-t-4 border-t-brand p-6 shadow-xl sm:p-7">
          <ActionForm action={login} submitLabel="Sign in" pendingLabel="Signing in…">
            {typeof next === "string" && <input type="hidden" name="next" value={next} />}
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
