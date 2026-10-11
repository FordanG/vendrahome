import Link from "next/link";
import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN } from "@/lib/auth";
import { requireHotel } from "@/lib/hotel";
import { formatRate, formatReading, liveUtilityBills, rateToInput } from "@/lib/billing";
import { addDaysISO, addMonthsISO, formatDate, formatPeso, todayISO } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { AutoSubmitSelect } from "@/components/auto-submit";
import { Badge, Card, Empty, Field, FormGrid, Input, PageHeader, SectionTitle, Select, Table, Td, Th } from "@/components/ui";
import { reverseCharge } from "../actions";
import { BillingTabs, ReverseButton } from "../parts";
import { addUtilityBill, saveUtilityType } from "./actions";

export default async function UtilitiesPage({ searchParams }: PageProps<"/billing/utilities">) {
  const { hotel } = await requireHotel(CAN.manageBilling);
  const db = await getDb();
  const today = todayISO();
  const sp = await searchParams;
  const contracts = await db
    .select({ id: schema.contracts.id, reference: schema.contracts.reference, client: schema.clients.name, status: schema.contracts.status })
    .from(schema.contracts)
    .innerJoin(schema.clients, eq(schema.contracts.clientId, schema.clients.id))
    .where(and(eq(schema.contracts.propertyId, hotel.id), inArray(schema.contracts.status, ["active", "ended", "terminated"])))
    .orderBy(asc(schema.contracts.startDate));
  const contract = contracts.find((c) => c.id === sp.contract) ?? contracts.find((c) => c.status === "active") ?? contracts[0];
  const types = await db.select().from(schema.utilityTypes).orderBy(asc(schema.utilityTypes.position), asc(schema.utilityTypes.name));
  const history = contract ? await Promise.all(types.map(async (t) => ({ type: t, bills: await liveUtilityBills(t.id, contract.id) }))) : [];

  return (
    <>
      <PageHeader
        title="Billing"
        subtitle="Electricity, water and other utilities: one bill a period for the whole contract, charged to the company on its next statement."
      />
      <BillingTabs active="utilities" isAdmin />

      {!contract ? (
        <Empty>No active contract yet. Utilities are billed to a company under its contract.</Empty>
      ) : (
        <>
          {contracts.length > 1 && (
            <form className="mb-6 max-w-sm">
              <Field label="Contract">
                <AutoSubmitSelect name="contract" defaultValue={contract.id}>
                  {contracts.map((c) => <option key={c.id} value={c.id}>{c.client}, {c.reference}</option>)}
                </AutoSubmitSelect>
              </Field>
            </form>
          )}
          <div className="space-y-6">
            {history.filter((h) => h.type.active).map(({ type, bills }) => {
              const last = bills[0];
              const recent = bills.slice(1, 4);
              const usual = recent.length ? Math.round(recent.reduce((n, b) => n + b.amount, 0) / recent.length) : null;
              const start = last ? addDaysISO(last.periodEnd, 1) : addMonthsISO(today, -1);
              const end = addDaysISO(addMonthsISO(start, 1), -1);
              return (
                <Card key={type.id}>
                  <SectionTitle>
                    {type.name}
                    {type.provider && <span className="ml-2 text-sm font-normal text-muted">{type.provider}</span>}
                  </SectionTitle>
                  <div className="grid gap-6 lg:grid-cols-2">
                    <div className="min-w-0">
                      {bills.length === 0 ? (
                        <p className="text-sm text-muted">No bills entered for {contract.client} yet.</p>
                      ) : (
                        <Table>
                          <thead>
                            <tr><Th>Period</Th><Th>Usage</Th><Th className="text-right">Amount</Th><Th /></tr>
                          </thead>
                          <tbody>
                            {bills.slice(0, 12).map((b, i) => {
                              const before = bills.slice(i + 1, i + 4);
                              const avg = before.length ? before.reduce((n, x) => n + x.amount, 0) / before.length : null;
                              const high = avg !== null && b.amount > avg * 1.5;
                              return (
                                <tr key={b.id}>
                                  <Td primary>
                                    {formatDate(b.periodStart)} – {formatDate(b.periodEnd)}
                                    {high && <span className="ml-2"><Badge tone="amber">Much higher than usual</Badge></span>}
                                  </Td>
                                  <Td label="Usage">
                                    {b.method === "meter"
                                      ? `${formatReading(b.currentReading! - b.previousReading!)} ${type.unit ?? ""} at ${formatRate(b.rate)}`
                                      : "From the bill"}
                                    {b.photoId && <> · <Link className="underline" href={`/api/photos/${b.photoId}`} target="_blank">Photo</Link></>}
                                  </Td>
                                  <Td label="Amount" className="text-right tabular-nums">{formatPeso(b.amount)}</Td>
                                  <Td className="no-print">{b.chargeId && <ReverseButton action={reverseCharge.bind(null, b.chargeId)} />}</Td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </Table>
                      )}
                      {usual !== null && <p className="mt-2 text-xs text-muted">Usual amount (last 3 before the latest): {formatPeso(usual)}.</p>}
                    </div>
                    <div className="min-w-0">
                      <ActionForm action={addUtilityBill} submitLabel={`Save ${type.name.toLowerCase()} bill`} resetOnSuccess>
                        <input type="hidden" name="utilityTypeId" value={type.id} />
                        <input type="hidden" name="contractId" value={contract.id} />
                        <FormGrid>
                          <Field label="Period from">
                            <Input name="periodStart" type="date" defaultValue={start} required />
                          </Field>
                          <Field label="Period to">
                            <Input name="periodEnd" type="date" defaultValue={end <= today ? end : today} max={today} required />
                          </Field>
                          <Field label="Entered from">
                            <Select name="method" defaultValue={type.defaultMethod}>
                              <option value="bill">The provider&apos;s bill</option>
                              <option value="meter">Main-meter reading</option>
                            </Select>
                          </Field>
                          <Field label="Due date" hint="Optional, from the bill">
                            <Input name="dueDate" type="date" />
                          </Field>
                          <Field label="Amount on the bill (₱)" hint="For a bill">
                            <Input name="amount" inputMode="decimal" />
                          </Field>
                          <Field label={`Rate per ${type.unit ?? "unit"} (₱)`} hint="For a meter reading">
                            <Input name="rate" inputMode="decimal" defaultValue={rateToInput(last?.rate ?? type.rate)} />
                          </Field>
                          <Field label="Previous reading" hint="For a meter reading">
                            <Input name="previousReading" inputMode="decimal" defaultValue={last?.currentReading != null ? String(last.currentReading / 1000) : ""} />
                          </Field>
                          <Field label="This reading" hint="For a meter reading">
                            <Input name="currentReading" inputMode="decimal" />
                          </Field>
                        </FormGrid>
                        <Field label="Photo of the bill or meter" hint="Optional but recommended">
                          <Input name="photo" type="file" accept="image/*" />
                        </Field>
                        <Field label="Notes">
                          <Input name="notes" />
                        </Field>
                      </ActionForm>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}

      <section className="mt-10">
        <SectionTitle>Utilities</SectionTitle>
        <div className="grid gap-4 lg:grid-cols-3">
          {types.map((t) => (
            <Card key={t.id}>
              <ActionForm action={saveUtilityType.bind(null, t.id)} submitLabel="Save" submitVariant="secondary">
                <UtilityFields type={t} />
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="active" defaultChecked={t.active} /> In use
                </label>
              </ActionForm>
            </Card>
          ))}
          <Card>
            <SectionTitle>Add a utility</SectionTitle>
            <ActionForm action={saveUtilityType.bind(null, null)} submitLabel="Add" resetOnSuccess>
              <UtilityFields />
            </ActionForm>
          </Card>
        </div>
      </section>
    </>
  );
}

function UtilityFields({ type }: { type?: { name: string; provider: string | null; unit: string | null; defaultMethod: "bill" | "meter"; rate: number | null } }) {
  return (
    <>
      <Field label="Name">
        <Input name="name" defaultValue={type?.name} required placeholder="e.g. Internet" />
      </Field>
      <FormGrid>
        <Field label="Provider">
          <Input name="provider" defaultValue={type?.provider ?? ""} />
        </Field>
        <Field label="Unit" hint="e.g. kWh, m³">
          <Input name="unit" defaultValue={type?.unit ?? ""} />
        </Field>
        <Field label="Usually entered from">
          <Select name="defaultMethod" defaultValue={type?.defaultMethod ?? "bill"}>
            <option value="bill">The provider&apos;s bill</option>
            <option value="meter">Main-meter reading</option>
          </Select>
        </Field>
        <Field label="Rate per unit (₱)" hint="For meter readings">
          <Input name="rate" inputMode="decimal" defaultValue={rateToInput(type?.rate)} />
        </Field>
      </FormGrid>
    </>
  );
}
