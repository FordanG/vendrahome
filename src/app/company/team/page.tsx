import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { COMPANY_CAN, COMPANY_ROLES, requireCompany, ROLE_LABELS } from "@/lib/auth";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Field, Input, PageHeader, SectionTitle, Select } from "@/components/ui";
import type { Staff } from "@/db/schema";
import { saveTeamMember } from "../actions";

const ROLE_HELP = {
  company_admin: "Everything for your company, including bills and this team page",
  company_staff: "Rooms, people and requests; no bills, no team",
} as const;

function RoleSelect({ value }: { value?: Staff["role"] }) {
  return (
    <Field label="Role">
      <Select name="role" defaultValue={value ?? "company_staff"}>
        {(["company_staff", "company_admin"] as const).map((r) => (
          <option key={r} value={r}>
            {ROLE_LABELS[r]}: {ROLE_HELP[r]}
          </option>
        ))}
      </Select>
    </Field>
  );
}

export default async function CompanyTeamPage() {
  const { user, client } = await requireCompany(COMPANY_CAN.manageTeam);
  const db = await getDb();
  const team = await db
    .select()
    .from(schema.staff)
    .where(and(eq(schema.staff.clientId, client.id), inArray(schema.staff.role, COMPANY_ROLES)))
    .orderBy(asc(schema.staff.name));

  return (
    <>
      <PageHeader title="Team" subtitle={`Logins for people at ${client.name} who look after your rooms and people.`} />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          {team.map((m) => (
            <Card key={m.id}>
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                  <span className="font-semibold">{m.name}</span>
                  <Badge tone={m.role === "company_admin" ? "blue" : "gray"}>{ROLE_LABELS[m.role]}</Badge>
                  {!m.active && <Badge tone="red">Turned off</Badge>}
                  {m.id === user.id && <span className="text-xs text-muted">You</span>}
                  <span className="w-full text-sm text-muted">Signs in as {m.username}</span>
                </summary>
                <ActionForm action={saveTeamMember.bind(null, m.id)} className="mt-4 space-y-4">
                  <RoleSelect value={m.role} />
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="active" defaultChecked={m.active} /> Can sign in
                  </label>
                  <Field label="New password" hint="Leave blank to keep the current one">
                    <Input name="password" type="password" autoComplete="new-password" />
                  </Field>
                </ActionForm>
              </details>
            </Card>
          ))}
        </div>
        <Card className="self-start">
          <SectionTitle>Add someone</SectionTitle>
          <ActionForm action={saveTeamMember.bind(null, null)} submitLabel="Add login" resetOnSuccess>
            <Field label="Name">
              <Input name="name" required />
            </Field>
            <Field label="Username">
              <Input name="username" autoCapitalize="none" autoComplete="off" required />
            </Field>
            <Field label="Password" hint="At least 8 characters">
              <Input name="password" type="password" autoComplete="new-password" required />
            </Field>
            <RoleSelect />
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
