import type { Client } from "@/db/schema";
import { Field, FormGrid, Input, Textarea } from "@/components/ui";

export function ClientFields({ client }: { client?: Client }) {
  return (
    <FormGrid>
      <Field label="Company name" className="sm:col-span-2">
        <Input name="name" defaultValue={client?.name} required />
      </Field>
      <Field label="TIN (tax number)" className="sm:col-span-2">
        <Input name="tin" defaultValue={client?.tin ?? ""} />
      </Field>
      <Field label="Address" className="sm:col-span-2">
        <Input name="address" defaultValue={client?.address ?? ""} />
      </Field>
      <Field label="Contact person">
        <Input name="contactName" defaultValue={client?.contactName ?? ""} />
      </Field>
      <Field label="Contact mobile">
        <Input name="contactPhone" type="tel" defaultValue={client?.contactPhone ?? ""} />
      </Field>
      <Field label="Contact email" className="sm:col-span-2">
        <Input name="contactEmail" type="email" defaultValue={client?.contactEmail ?? ""} />
      </Field>
      <Field label="Notes" className="sm:col-span-2">
        <Textarea name="notes" defaultValue={client?.notes ?? ""} />
      </Field>
    </FormGrid>
  );
}
