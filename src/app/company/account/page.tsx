import { requireCompany } from "@/lib/auth";
import { ActionForm } from "@/components/action-form";
import { Card, Field, Input, PageHeader, SectionTitle } from "@/components/ui";
import { AccountProfile } from "@/components/account-profile";
import { ThemePicker } from "@/components/theme-picker";
import { changeOwnPassword } from "../../(app)/staff/actions";

export default async function CompanyAccountPage() {
  const { user, client } = await requireCompany();
  return (
    <>
      <PageHeader title="Account" subtitle={`Your login for ${client.name}.`} />
      <AccountProfile user={user} />
      <Card className="max-w-md">
        <SectionTitle>Password</SectionTitle>
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
