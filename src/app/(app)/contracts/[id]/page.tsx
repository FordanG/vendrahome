import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN, requireStaff } from "@/lib/auth";
import { daysBetween, formatDate, formatPeso, todayISO } from "@/lib/format";
import { contractMonthOf, contractMonths, contractTotal, rentForMonth, rentSchedule, type RentPeriod } from "@/lib/rent";
import { ActionForm } from "@/components/action-form";
import { RoomPicker } from "@/components/room-picker";
import {
  Badge,
  Button,
  Card,
  Detail,
  Empty,
  Field,
  FormGrid,
  Input,
  PageHeader,
  SectionTitle,
  Select,
  Table,
  Td,
  Th,
} from "@/components/ui";
import {
  addContractRooms,
  addRentStep,
  removeRentStep,
  setContractStatus,
  updateContract,
  updateContractRooms,
} from "../actions";
import { ContractFields } from "../contract-fields";
import { CONTRACT_STATUS_LABELS, CONTRACT_STATUS_TONES } from "../status";
import { ContractRoomsForm } from "./contract-rooms-form";

export default async function ContractPage({ params }: PageProps<"/contracts/[id]">) {
  const user = await requireStaff(CAN.viewClients);
  const { id } = await params;
  const db = await getDb();
  const contract = await db.query.contracts.findFirst({ where: eq(schema.contracts.id, id) });
  if (!contract) notFound();

  const [client, clients, steps, contractRooms, allRooms, stays] = await Promise.all([
    db.query.clients.findFirst({ where: eq(schema.clients.id, contract.clientId) }),
    db.select({ id: schema.clients.id, name: schema.clients.name }).from(schema.clients).orderBy(asc(schema.clients.name)),
    db.select().from(schema.rentSteps).where(eq(schema.rentSteps.contractId, id)).orderBy(asc(schema.rentSteps.startMonth)),
    db
      .select({ cr: schema.contractRooms, room: schema.rooms })
      .from(schema.contractRooms)
      .innerJoin(schema.rooms, eq(schema.contractRooms.roomId, schema.rooms.id))
      .where(eq(schema.contractRooms.contractId, id))
      .orderBy(asc(schema.rooms.floor), asc(schema.rooms.number)),
    db.select().from(schema.rooms).orderBy(asc(schema.rooms.floor), asc(schema.rooms.number)),
    db
      .select({ roomId: schema.roomAssignments.roomId })
      .from(schema.roomAssignments)
      .where(and(eq(schema.roomAssignments.contractId, id), isNull(schema.roomAssignments.actualCheckOut))),
  ]);

  const canManage = CAN.manageContracts.includes(user.role);
  const canEditTerms = canManage && contract.status === "draft";
  const today = todayISO();
  const perRoom = contract.rentType === "per_room";
  const base = perRoom ? contractRooms.reduce((sum, r) => sum + (r.cr.monthlyRate ?? 0), 0) : contract.monthlyRent;
  const missingRates = perRoom ? contractRooms.filter((r) => r.cr.monthlyRate == null).length : 0;
  let schedule: RentPeriod[] = [];
  let rentError = false;
  try { schedule = rentSchedule(base, steps, contract.startDate, contract.endDate, contract.partialMonthPolicy); }
  catch { rentError = true; }
  const months = contractMonths(contract.startDate, contract.endDate);
  const monthNow = contractMonthOf(contract.startDate, contract.endDate, today);
  const rentNow = !rentError && contract.status === "active" && monthNow ? rentForMonth(base, steps, monthNow) : null;
  const nextChange = schedule.find((p) => p.fromMonth > (monthNow ?? 0) && p.fromMonth > 1);
  const daysToChange = nextChange ? daysBetween(today, nextChange.fromDate) : null;
  const peopleByRoom = new Map<string, number>();
  for (const s of stays) peopleByRoom.set(s.roomId, (peopleByRoom.get(s.roomId) ?? 0) + 1);
  const inContract = new Set(contractRooms.map((r) => r.room.id));

  return (
    <>
      <PageHeader
        back={{ href: "/contracts", label: "Contracts" }}
        title={contract.reference}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge tone={CONTRACT_STATUS_TONES[contract.status]}>{CONTRACT_STATUS_LABELS[contract.status]}</Badge>
            <Link className="underline" href={`/clients/${contract.clientId}`}>
              {client?.name}
            </Link>
            <span>
              {contractRooms.length} rooms, {formatDate(contract.startDate)} to {formatDate(contract.endDate)}
            </span>
          </span>
        }
      />

      {rentError && <Card className="mb-6 border-warn text-sm">This saved rent schedule contains invalid amounts. Do not use its totals; ask the administrator to review the original contract records.</Card>}
      {contract.status !== "draft" && <Card className="mb-6 text-sm">Activated terms, rooms and rent steps are locked to preserve history. Create a new contract for a renewal or changed terms.</Card>}
      {daysToChange !== null && daysToChange >= 0 && daysToChange <= 60 && (
        <Card className="mb-6 border-warn text-sm">
          Rent changes to <strong>{formatPeso(nextChange!.monthly)}</strong> a month from{" "}
          {formatDate(nextChange!.fromDate)} (month {nextChange!.fromMonth}), in {daysToChange} days.
        </Card>
      )}
      {missingRates > 0 && (
        <Card className="mb-6 border-warn text-sm">
          {missingRates === 1 ? "1 room has" : `${missingRates} rooms have`} no monthly rate yet. The rent below counts
          them as ₱0 until you add a rate.
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <dl className="grid gap-4 sm:grid-cols-3">
              <Detail label="Rent this month">{rentNow !== null ? `${formatPeso(rentNow)} a month` : "Contract isn't running today"}</Detail>
              <Detail label="Month of the contract">{monthNow ? `Month ${monthNow} of ${months}` : `${months} months long`}</Detail>
              <Detail label="Time left">
                {today <= contract.endDate ? `${daysBetween(today, contract.endDate)} days` : "Ended"}
              </Detail>
              <Detail label="Deposit">{formatPeso(contract.deposit)}</Detail>
              <Detail label="Advance rent">{formatPeso(contract.advance)}</Detail>
              <Detail label="Billing day">Day {contract.billingDay} of each month</Detail>
              <Detail label="How rent is set">{perRoom ? "A rate for each room" : "One amount for all rooms"}</Detail>
              <Detail label="Payment terms">{contract.paymentTerms}</Detail>
              <Detail label="Partial final month">{contract.partialMonthPolicy === "full" ? "Full month charged" : "Prorated by contract-month days"}</Detail>
              <Detail label="Total rent for the whole contract">{rentError ? "Needs review" : formatPeso(contractTotal(schedule))}</Detail>
            </dl>
          </Card>

          <div>
            <SectionTitle>Rent schedule</SectionTitle>
            <Table>
              <thead>
                <tr>
                  <Th>Months</Th>
                  <Th>Dates</Th>
                  <Th className="text-right">Monthly rent</Th>
                  <Th className="text-right">Subtotal</Th>
                </tr>
              </thead>
              <tbody>
                {schedule.map((p) => {
                  const current = monthNow !== null && monthNow >= p.fromMonth && monthNow <= p.toMonth;
                  return (
                    <tr key={p.fromMonth} className={current ? "bg-accent/5" : ""}>
                      <Td primary>
                        {p.fromMonth === p.toMonth ? `Month ${p.fromMonth}` : `Months ${p.fromMonth}–${p.toMonth}`}
                        {current && (
                          <span className="ml-2">
                            <Badge tone="blue">Current</Badge>
                          </span>
                        )}
                      </Td>
                      <Td label="Dates" wide>
                        {formatDate(p.fromDate)} – {formatDate(p.toDate)}
                        {p.note && <span className="block text-xs text-muted">{p.note}</span>}
                      </Td>
                      <Td label="Monthly rent" className="text-right">{formatPeso(p.monthly)}</Td>
                      <Td label="Subtotal" className="text-right">{formatPeso(p.total)}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>

          <Card>
            <SectionTitle>Rent changes</SectionTitle>
            {steps.length === 0 ? (
              <p className="mb-4 text-sm text-muted">No increases set. Rent stays the same for the whole term.</p>
            ) : (
              <ul className="mb-4 divide-y divide-border text-sm">
                {steps.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 py-2">
                    <span>
                      From month {s.startMonth} ({formatDate(schedule.find((p) => p.fromMonth === s.startMonth)?.fromDate)}):{" "}
                      <strong>
                        {s.kind === "percent" ? `+${(s.value / 100).toFixed(2).replace(/\.00$/, "")}%` : `${formatPeso(s.value)} / month`}
                      </strong>
                      {s.note && <span className="text-muted"> ({s.note})</span>}
                    </span>
                    {canEditTerms && (
                      <form
                        action={async () => {
                          "use server";
                          await removeRentStep(contract.id, s.id);
                        }}
                      >
                        <Button variant="ghost" className="text-xs">
                          Remove
                        </Button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canEditTerms && (
              <ActionForm action={addRentStep.bind(null, contract.id)} submitLabel="Add rent change" resetOnSuccess>
                <FormGrid>
                  <Field label="Starts in month" hint={`A month from 2 to ${months}. Month 13 is the start of year 2.`}>
                    <Input name="startMonth" type="number" min={2} max={months} defaultValue={13} required />
                  </Field>
                  <Field label="Type">
                    <Select name="kind" defaultValue="percent">
                      <option value="percent">Increase by %</option>
                      <option value="amount">New monthly amount (₱)</option>
                    </Select>
                  </Field>
                  <Field label="Value" hint="e.g. 5 for 5%, or 1,250,000 for a new amount">
                    <Input name="value" inputMode="decimal" required />
                  </Field>
                  <Field label="Note">
                    <Input name="note" placeholder="e.g. Year 2 escalation" />
                  </Field>
                </FormGrid>
              </ActionForm>
            )}
          </Card>

          <div>
            <SectionTitle>Rooms leased in this contract ({contractRooms.length})</SectionTitle>
            {contractRooms.length === 0 ? (
              <Empty>No rooms yet. Add them below.</Empty>
            ) : (
              <ContractRoomsForm
                action={updateContractRooms.bind(null, contract.id)}
                perRoom={perRoom}
                canManage={canEditTerms}
                rows={contractRooms.map(({ cr, room }) => ({
                  id: cr.id,
                  number: room.number,
                  floor: room.floor,
                  rate: cr.monthlyRate != null ? formatPeso(cr.monthlyRate) : "",
                  people: peopleByRoom.get(room.id) ?? 0,
                  capacity: room.capacity,
                }))}
              />
            )}
          </div>

          {canEditTerms && (
            <details className="rounded-lg border border-border bg-surface">
              <summary className="cursor-pointer select-none px-5 py-4 text-base font-semibold">Change contract terms</summary>
              <div className="border-t border-border p-5">
                <ActionForm action={updateContract.bind(null, contract.id)}>
                  <ContractFields clients={clients} contract={contract} />
                </ActionForm>
              </div>
            </details>
          )}

          {canEditTerms && allRooms.length > inContract.size && (
            <Card>
              <SectionTitle>Add rooms</SectionTitle>
              <ActionForm action={addContractRooms.bind(null, contract.id)} submitLabel="Add ticked rooms">
                <RoomPicker
                  name="roomIds"
                  rooms={allRooms
                    .filter((r) => !inContract.has(r.id))
                    .map((r) => ({ id: r.id, label: r.number, floor: r.floor }))}
                />
                {perRoom && (
                  <Field label="Monthly rate for these rooms (₱)" hint="Optional. You can set rates later.">
                    <Input name="monthlyRate" inputMode="decimal" className="max-w-xs" />
                  </Field>
                )}
              </ActionForm>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {canManage && (
            <Card>
              <SectionTitle>Status</SectionTitle>
              <ActionForm action={setContractStatus.bind(null, contract.id)} submitLabel="Update status">
                <Field
                  label="Contract status"
                  hint="Only active contracts show on the room board. Activating checks that no room is in another active contract."
                >
                  <Select name="status" defaultValue={contract.status}>
                    {Object.entries(CONTRACT_STATUS_LABELS).filter(([k]) => k === contract.status || (contract.status === "draft" ? k === "active" : contract.status === "active" ? k === "ended" || k === "terminated" : false)).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </Select>
                </Field>
              </ActionForm>
            </Card>
          )}
          {contract.notes && (
            <Card>
              <SectionTitle>Notes</SectionTitle>
              <p className="whitespace-pre-wrap text-sm">{contract.notes}</p>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
