import { asc } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN, requireStaff } from "@/lib/auth";
import { BILL_TO_LABELS } from "@/lib/billing";
import { ActionForm } from "@/components/action-form";
import { Card, Field, FormGrid, Input, PageHeader, SectionTitle, Select } from "@/components/ui";
import { saveChargeType } from "../actions";
import { BillingTabs } from "../parts";

export default async function ChargeTypesPage() {
  await requireStaff(CAN.manageBilling);
  const db = await getDb();
  const types = await db.select().from(schema.chargeTypes).orderBy(asc(schema.chargeTypes.position), asc(schema.chargeTypes.name));
  return (
    <>
      <PageHeader title="Billing" subtitle="Kinds of charges, and who normally pays each. A contract can change who pays under its own terms." />
      <BillingTabs active="settings" isAdmin />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-3 lg:col-span-2">
          {types.map((t) => {
            const fixed = t.code === "rent" || t.code === "utility";
            return (
              <Card key={t.id}>
                <ActionForm action={saveChargeType.bind(null, t.id)} submitLabel="Save" submitVariant="secondary">
                  <FormGrid>
                    <Field label="Name">
                      <Input name="name" defaultValue={t.name} required />
                    </Field>
                    <Field label="Usually paid by" hint={fixed ? "Always the company" : undefined}>
                      <Select name="defaultBillTo" defaultValue={t.defaultBillTo} disabled={fixed}>
                        <option value="company">{BILL_TO_LABELS.company}</option>
                        <option value="occupant">{BILL_TO_LABELS.occupant}</option>
                      </Select>
                    </Field>
                  </FormGrid>
                  {!fixed && (
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="active" defaultChecked={t.active} /> In use (unticked types can&apos;t be picked for new charges)
                    </label>
                  )}
                </ActionForm>
              </Card>
            );
          })}
        </div>
        <Card className="self-start">
          <SectionTitle>Add a charge type</SectionTitle>
          <ActionForm action={saveChargeType.bind(null, null)} submitLabel="Add" resetOnSuccess>
            <Field label="Name">
              <Input name="name" required placeholder="e.g. Parking" />
            </Field>
            <Field label="Usually paid by">
              <Select name="defaultBillTo" defaultValue="company">
                <option value="company">{BILL_TO_LABELS.company}</option>
                <option value="occupant">{BILL_TO_LABELS.occupant}</option>
              </Select>
            </Field>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
