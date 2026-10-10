import { asc, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN, requireStaff, ROLE_LABELS, STAFF_ROLES } from "@/lib/auth";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Field, FormGrid, Input, PageHeader, SectionTitle, Select } from "@/components/ui";
import { createStaff, updateStaff } from "./actions";

function RoleSelect({ defaultValue }: { defaultValue?: string }) {
  return (
    <Select name="role" defaultValue={defaultValue ?? "front_desk"}>
      {STAFF_ROLES.map((r) => (
        <option key={r} value={r}>
          {ROLE_LABELS[r]}
        </option>
      ))}
    </Select>
  );
}

export default async function StaffPage() {
  await requireStaff(CAN.manageStaff);
  const db = await getDb();
  // Tenant logins are managed on each occupant's page, company logins on each company's page.
  const staff = await db
    .select()
    .from(schema.staff)
    .where(inArray(schema.staff.role, STAFF_ROLES))
    .orderBy(asc(schema.staff.name));

  return (
    <>
      <PageHeader title="Staff accounts" subtitle="Logins for people who work at the hotel. Each role only sees what it needs." />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          {staff.map((s) => (
            <Card key={s.id}>
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="font-medium">{s.name}</p>
                  <p className="text-xs text-muted">Username: {s.username}</p>
                </div>
                {!s.active && <Badge tone="red">Turned off</Badge>}
              </div>
              <ActionForm action={updateStaff.bind(null, s.id)} className="space-y-3">
                <FormGrid>
                  <Field label="Role" className="sm:col-span-2">
                    <RoleSelect defaultValue={s.role} />
                  </Field>
                  <Field label="Reset password" hint="Leave blank to keep it" className="sm:col-span-2">
                    <Input name="password" type="password" autoComplete="new-password" />
                  </Field>
                </FormGrid>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="active" defaultChecked={s.active} /> Allowed to sign in
                </label>
              </ActionForm>
            </Card>
          ))}
        </div>
        <Card className="self-start">
          <SectionTitle>Add staff</SectionTitle>
          <ActionForm action={createStaff} submitLabel="Add staff" resetOnSuccess>
            <FormGrid>
              <Field label="Name">
                <Input name="name" required />
              </Field>
              <Field label="Username">
                <Input name="username" autoCapitalize="none" required />
              </Field>
              <Field label="Role" className="sm:col-span-2">
                <RoleSelect />
              </Field>
              <Field label="Password" hint="At least 8 characters" className="sm:col-span-2">
                <Input name="password" type="password" autoComplete="new-password" required />
              </Field>
            </FormGrid>
          </ActionForm>
          <div className="mt-6 space-y-1 text-xs text-muted">
            <p><strong>Admin:</strong> everything, including contracts, rates and staff.</p>
            <p><strong>Front desk &amp; housekeeping:</strong> tenants and their rooms, room condition, requests, maintenance, the kitchen and laundry timetable, and viewing companies and contracts.</p>
            <p><strong>Maintenance:</strong> the room board, room condition, maintenance visits and tenant requests.</p>
            <p><strong>Tenant:</strong> a tenant&apos;s own login. Create it from the tenant&apos;s page, not here.</p>
          </div>
        </Card>
      </div>
    </>
  );
}
