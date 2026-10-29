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
    <main className="relative flex flex-1 items-center justify-center overflow-hidden bg-sidebar p-4">
      {/* A soft orange glow behind the card. */}
      <div className="pointer-events-none absolute left-1/2 top-1/3 size-[36rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand/[0.13] blur-3xl" aria-hidden />
      <div className="relative w-full max-w-sm">
        <h1 className="mb-2 flex justify-center text-4xl text-sidebar-foreground">
          <Brand />
        </h1>
        <p className="mb-7 text-center text-sm text-sidebar-muted">For staff, tenants and companies</p>
        <Card className="rounded-2xl border-white/10 p-6 shadow-pop sm:p-8">
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
        <p className="mt-5 text-center text-xs text-sidebar-muted">Forgot your password? Ask the front desk to reset it.</p>
      </div>
    </main>
  );
}
