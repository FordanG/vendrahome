import type { Contract } from "@/db/schema";
import { centavosToInput } from "@/lib/format";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui";

export function ContractFields({
  clients,
  contract,
  defaultClientId,
}: {
  clients: { id: string; name: string }[];
  contract?: Contract;
  defaultClientId?: string;
}) {
  return (
    <FormGrid>
      <Field label="Company">
        <Select name="clientId" defaultValue={contract?.clientId ?? defaultClientId ?? ""} required>
          <option value="" disabled>
            Pick a company
          </option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Contract name or number" hint="How you refer to this contract, e.g. PO-2026-01">
        <Input name="reference" defaultValue={contract?.reference} required />
      </Field>
      <Field label="Start date">
        <Input name="startDate" type="date" defaultValue={contract?.startDate} required />
      </Field>
      <Field label="End date">
        <Input name="endDate" type="date" defaultValue={contract?.endDate} required />
      </Field>
      <Field label="How rent is set">
        <Select name="rentType" defaultValue={contract?.rentType ?? "total"}>
          <option value="total">One monthly amount for all rooms</option>
          <option value="per_room">A rate for each room, added together</option>
        </Select>
      </Field>
      <Field label="Monthly rent (₱)" hint="Used when rent is one amount for all rooms. Rates for each room are set in the rooms list.">
        <Input name="monthlyRent" inputMode="decimal" defaultValue={centavosToInput(contract?.monthlyRent)} placeholder="0.00" />
      </Field>
      <Field label="Deposit (₱)">
        <Input name="deposit" inputMode="decimal" defaultValue={centavosToInput(contract?.deposit ?? 0)} required />
      </Field>
      <Field label="Advance rent (₱)">
        <Input name="advance" inputMode="decimal" defaultValue={centavosToInput(contract?.advance ?? 0)} required />
      </Field>
      <Field label="Billing day" hint="Day of the month rent is billed (1–28)">
        <Input name="billingDay" type="number" min={1} max={28} defaultValue={contract?.billingDay ?? 1} required />
      </Field>
      <Field label="Partial final month" hint="Months run from the start-date anniversary; the end date is inclusive.">
        <Select name="partialMonthPolicy" defaultValue={contract?.partialMonthPolicy ?? "full"}>
          <option value="full">Charge a full month</option>
          <option value="prorated">Prorate by days in that contract month</option>
        </Select>
      </Field>
      <Field label="Payment terms" hint="e.g. Due within 5 days of billing">
        <Input name="paymentTerms" defaultValue={contract?.paymentTerms ?? ""} />
      </Field>
      <Field label="Notes" className="sm:col-span-2">
        <Textarea name="notes" defaultValue={contract?.notes ?? ""} />
      </Field>
    </FormGrid>
  );
}
