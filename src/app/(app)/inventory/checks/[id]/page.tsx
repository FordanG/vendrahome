import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN, requireStaff } from "@/lib/auth";
import { roomInReach } from "@/lib/hotel";
import { CHECK_KIND_LABELS, CONDITION_LABELS, CONDITION_TONES, checkDifferences } from "@/lib/inventory";
import { centavosToInput, formatDate, formatMoment, formatPeso } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Detail, Field, PageHeader, SectionTitle, Select, Input, Table, Td, Th } from "@/components/ui";
import { chargeDifference, deductDifference } from "../../actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default async function CheckPage({ params }: PageProps<"/inventory/checks/[id]">) {
  const user = await requireStaff(CAN.viewInventory);
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const db = await getDb();
  const check = await db.query.inventoryChecks.findFirst({ where: eq(schema.inventoryChecks.id, id) });
  if (!check || !(await roomInReach(user, check.roomId))) notFound();
  const [room, by, stay, contract, { baseline, lines, differences }] = await Promise.all([
    db.query.rooms.findFirst({ where: eq(schema.rooms.id, check.roomId) }),
    check.checkedBy ? db.query.staff.findFirst({ where: eq(schema.staff.id, check.checkedBy), columns: { name: true } }) : null,
    check.assignmentId
      ? db.select({ name: schema.occupants.fullName, checkIn: schema.roomAssignments.checkIn, occupantId: schema.occupants.id })
          .from(schema.roomAssignments).innerJoin(schema.occupants, eq(schema.roomAssignments.occupantId, schema.occupants.id))
          .where(eq(schema.roomAssignments.id, check.assignmentId)).then((r) => r[0])
      : null,
    check.contractId ? db.query.contracts.findFirst({ where: eq(schema.contracts.id, check.contractId) }) : null,
    checkDifferences(check),
  ]);
  // A door-code check-in by the same person at this room in the hours before the check was saved.
  const scanned = check.checkedBy
    ? await db.query.roomCheckIns.findFirst({
        where: and(
          eq(schema.roomCheckIns.roomId, check.roomId),
          eq(schema.roomCheckIns.staffId, check.checkedBy),
          eq(schema.roomCheckIns.purpose, "inventory"),
          gte(schema.roomCheckIns.at, new Date(check.createdAt.getTime() - 3 * 3_600_000)),
          lte(schema.roomCheckIns.at, check.createdAt),
        ),
        orderBy: [desc(schema.roomCheckIns.at)],
      })
    : undefined;
  const canCharge = CAN.recordBilling.includes(user.role);
  const canDeduct = CAN.manageBilling.includes(user.role) && !!check.contractId;
  const showPeople = CAN.manageOccupants.includes(user.role);

  return (
    <>
      <PageHeader
        back={{ href: `/inventory/rooms/${check.roomId}`, label: `Room ${room?.number}` }}
        title={`${CHECK_KIND_LABELS[check.kind]}, room ${room?.number}`}
        subtitle={formatDate(check.checkedOn)}
      />
      <Card className="mb-6">
        <dl className="grid gap-4 sm:grid-cols-4">
          <Detail label="Checked by">
            {by?.name}
            {by && (
              <span className={`block text-xs ${scanned ? "text-muted" : "text-attention"}`}>
                {scanned ? `Scanned the door code ${formatMoment(scanned.at)}` : "Didn't scan the door code"}
              </span>
            )}
          </Detail>
          <Detail label="Signed off by">{check.signedBy}</Detail>
          <Detail label="Stay">{stay ? (showPeople ? stay.name : "A tenant's stay") + `, moved in ${formatDate(stay.checkIn)}` : null}</Detail>
          <Detail label="Contract">{contract?.reference}</Detail>
        </dl>
        {check.notes && <p className="mt-3 whitespace-pre-wrap text-sm">{check.notes}</p>}
      </Card>

      <section className="mb-8">
        <SectionTitle>What changed</SectionTitle>
        {!baseline ? (
          <Card className="text-sm text-muted">There&apos;s no earlier check to compare with. This check is the starting record for the next one.</Card>
        ) : (
          <>
            <p className="mb-3 text-sm text-muted">
              Compared with the{" "}
              <Link className="underline underline-offset-2" href={`/inventory/checks/${baseline.id}`}>
                {CHECK_KIND_LABELS[baseline.kind].toLowerCase()} of {formatDate(baseline.checkedOn)}
              </Link>.
            </p>
            {differences.length === 0 ? (
              <Card className="text-sm">Nothing is missing or in worse condition than before.</Card>
            ) : (
              <div className="space-y-3">
                {differences.map((d) => (
                  <Card key={d.line.id}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">{d.item.name}</p>
                        <p className="text-sm text-muted">
                          Before: {d.earlier.found} found, {CONDITION_LABELS[d.earlier.condition].toLowerCase()}. Now: {d.line.found} found,{" "}
                          {CONDITION_LABELS[d.line.condition].toLowerCase()}.
                          {d.line.note && ` ${d.line.note}`}
                        </p>
                        <p className="text-sm text-muted">Replacement cost {formatPeso(d.item.replacementCost)} each. Suggested: {formatPeso(d.suggested)}.</p>
                      </div>
                      {d.line.chargeId ? <Badge tone="green">Charged</Badge> : d.line.depositEntryId ? <Badge tone="green">Deducted from deposit</Badge> : null}
                    </div>
                    {!d.line.chargeId && !d.line.depositEntryId && (canCharge || canDeduct) && (
                      <div className="mt-3 grid gap-4 border-t border-border pt-3 md:grid-cols-2">
                        {canCharge && (
                          <ActionForm action={chargeDifference.bind(null, check.id, d.line.id)} submitLabel="Charge it" submitVariant="secondary" className="space-y-3">
                            <Field label="Amount (₱)">
                              <Input name="amount" inputMode="decimal" defaultValue={centavosToInput(d.suggested)} required />
                            </Field>
                            <Field label="Who pays">
                              <Select name="billTo" defaultValue="rule">
                                <option value="rule">As the contract&apos;s rules say</option>
                                <option value="company">The company</option>
                                {stay && <option value="occupant">The tenant</option>}
                              </Select>
                            </Field>
                          </ActionForm>
                        )}
                        {canDeduct && check.kind === "handover" && (
                          <ActionForm action={deductDifference.bind(null, check.id, d.line.id)} submitLabel="Deduct from deposit" submitVariant="secondary" className="space-y-3">
                            <Field label="Amount (₱)">
                              <Input name="amount" inputMode="decimal" defaultValue={centavosToInput(d.suggested)} required />
                            </Field>
                          </ActionForm>
                        )}
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      <section>
        <SectionTitle>Everything checked ({lines.length})</SectionTitle>
        <Table>
          <thead>
            <tr><Th>Item</Th><Th>Found</Th><Th>Condition</Th><Th>Note</Th></tr>
          </thead>
          <tbody>
            {lines.map(({ line, item }) => (
              <tr key={line.id}>
                <Td primary>{item.name}</Td>
                <Td label="Found">{line.found} of {item.quantity}</Td>
                <Td label="Condition"><Badge tone={CONDITION_TONES[line.condition]}>{CONDITION_LABELS[line.condition]}</Badge></Td>
                <Td label="Note" wide>
                  {line.note}
                  {line.photoId && <> <Link className="underline" href={`/api/photos/${line.photoId}`} target="_blank">Photo</Link></>}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>
    </>
  );
}
