import { requireStaff, ROLE_LABELS } from "@/lib/auth";
import { ActionForm } from "@/components/action-form";
import { Card, Field, Input, PageHeader } from "@/components/ui";
import { ThemePicker } from "@/components/theme-picker";
import { changeOwnPassword } from "../staff/actions";

export default async function AccountPage() {
  const user = await requireStaff();
  return (
    <>
      <PageHeader title="My account" subtitle={`${user.name}, ${ROLE_LABELS[user.role]}. You sign in as ${user.username}.`} />
      <Card className="max-w-md">
        <ActionForm action={changeOwnPassword} submitLabel="Change password" resetOnSuccess>
          <Field label="Current password">
            <Input name="current" type="password" autoComplete="current-password" required />
          </Field>
          <Field label="New password" hint="At least 8 characters">
            <Input name="next" type="password" autoComplete="new-password" required />
          </Field>
          <Field label="Repeat new password">
            <Input name="confirm" type="password" autoComplete="new-password" required />
          </Field>
        </ActionForm>
      </Card>
      <div className="mt-4">
        <ThemePicker />
      </div>
    </>
  );
}
