import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN } from "@/lib/auth";
import { requireHotel } from "@/lib/hotel";
import { centavosToInput, formatPeso } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { Card, Field, FormGrid, Input, PageHeader, SectionTitle } from "@/components/ui";
import type { LaundryService } from "@/db/schema";
import { saveService } from "../actions";

function ServiceFields({ s }: { s?: LaundryService }) {
  return (
    <>
      <Field label="Name" hint="e.g. Wash, dry and fold">
        <Input name="name" defaultValue={s?.name} required />
      </Field>
      <FormGrid>
        <Field label="Price per kilo" hint="What the tenant or company pays">
          <Input name="ratePerKilo" inputMode="decimal" defaultValue={centavosToInput(s?.ratePerKilo)} required />
        </Field>
        <Field label="Shop's cost per kilo" hint="What the shop charges you. Optional, for the margin">
          <Input name="costPerKilo" inputMode="decimal" defaultValue={centavosToInput(s?.costPerKilo)} />
        </Field>
        <Field label="Minimum charge" hint="Optional, e.g. the price of 3 kilos">
          <Input name="minimumCharge" inputMode="decimal" defaultValue={centavosToInput(s?.minimumCharge)} />
        </Field>
        <Field label="Days at the shop" hint="Usual time before it comes back">
          <Input name="turnaroundDays" type="number" min={0} max={14} defaultValue={s?.turnaroundDays ?? 2} className="w-24" />
        </Field>
      </FormGrid>
    </>
  );
}

export default async function LaundrySettingsPage() {
  const { hotel } = await requireHotel(CAN.manageLaundryRates);
  const db = await getDb();
  const services = await db.select().from(schema.laundryServices).where(eq(schema.laundryServices.propertyId, hotel.id)).orderBy(asc(schema.laundryServices.position), asc(schema.laundryServices.name));
  return (
    <>
      <PageHeader
        back={{ href: "/laundry", label: "Laundry" }}
        title="Laundry services and rates"
        subtitle="Who pays for laundry, the tenant or the company, follows each contract's charge rule for Laundry. New prices apply to loads weighed from now on."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          {services.map((s) => (
            <Card key={s.id}>
              <SectionTitle>
                {s.name}
                {!s.active && <span className="font-normal text-muted">, not offered</span>}
              </SectionTitle>
              <p className="mb-3 text-sm text-muted">
                {formatPeso(s.ratePerKilo)} a kilo{s.minimumCharge ? `, at least ${formatPeso(s.minimumCharge)}` : ""}
                {s.costPerKilo != null && `. The shop charges ${formatPeso(s.costPerKilo)} a kilo`}.
              </p>
              <details>
                <summary className="cursor-pointer text-sm underline underline-offset-2">Change</summary>
                <ActionForm action={saveService.bind(null, s.id)} className="mt-3 space-y-4">
                  <ServiceFields s={s} />
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="active" defaultChecked={s.active} /> Offered to tenants
                  </label>
                </ActionForm>
              </details>
            </Card>
          ))}
          {services.length === 0 && <p className="text-sm text-muted">No services yet. Add the first one.</p>}
        </div>
        <Card className="self-start">
          <SectionTitle>Add a service</SectionTitle>
          <ActionForm action={saveService.bind(null, null)} submitLabel="Add service" resetOnSuccess>
            <ServiceFields />
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
