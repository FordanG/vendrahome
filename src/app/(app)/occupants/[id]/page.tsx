import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN } from "@/lib/auth";
import { occupantInReach, requireHotel } from "@/lib/hotel";
import { getRoomOptions } from "@/lib/assignments";
import { OCCUPANT_FIELDS, OCCUPANT_GROUPS } from "@/lib/occupants";
import { daysBetween, formatDate, todayISO } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Detail, Field, FormGrid, Input, PageHeader, SectionTitle, Select, Table, Td, Th } from "@/components/ui";
import {
  assignRoom,
  cancelReservation,
  checkOut,
  createTenantLogin,
  editAssignment,
  transferRoom,
  updateOccupant,
  updateTenantLogin,
} from "../actions";
import { OccupantFields, roomLabel, StayFields } from "../occupant-fields";
import { StayCell } from "@/components/stay";

function Panel({ title, children, open }: { title: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details open={open} className="group rounded-md border border-border">
      <summary className="cursor-pointer select-none rounded-md px-3 py-2 text-sm font-medium hover:bg-background">{title}</summary>
      <div className="border-t border-border p-3">{children}</div>
    </details>
  );
}

export default async function OccupantPage({ params }: PageProps<"/occupants/[id]">) {
  const { user, hotel } = await requireHotel(CAN.manageOccupants);
  const { id } = await params;
  const db = await getDb();
  const occupant = await occupantInReach(user, id);
  if (!occupant) notFound();

  const [client, clients, history, rooms, login] = await Promise.all([
    occupant.clientId ? db.query.clients.findFirst({ where: eq(schema.clients.id, occupant.clientId) }) : null,
    db.select({ id: schema.clients.id, name: schema.clients.name }).from(schema.clients).orderBy(asc(schema.clients.name)),
    db
      .select({ a: schema.roomAssignments, roomNumber: schema.rooms.number, assignedBy: schema.staff.name })
      .from(schema.roomAssignments)
      .innerJoin(schema.rooms, eq(schema.roomAssignments.roomId, schema.rooms.id))
      .leftJoin(schema.staff, eq(schema.roomAssignments.assignedBy, schema.staff.id))
      .where(eq(schema.roomAssignments.occupantId, id))
      .orderBy(desc(schema.roomAssignments.checkIn), desc(schema.roomAssignments.createdAt)),
    getRoomOptions(occupant.propertyId ?? hotel.id),
    db.query.staff.findFirst({ where: eq(schema.staff.occupantId, id) }),
  ]);
  const current = history.find((h) => !h.a.actualCheckOut);
  const today = todayISO();
  const showIds = CAN.viewOccupantIds.includes(user.role);
  const canManageLogin = CAN.manageTenantLogins.includes(user.role);

  return (
    <>
      <PageHeader
        back={{ href: "/occupants", label: "Tenants" }}
        title={occupant.fullName}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            {current ? (
              <Badge tone="green">
                {current.a.checkIn > today ? "Reserved room" : "Room"} {current.roomNumber}
                {current.a.slot && `, ${current.a.slot}`}
              </Badge>
            ) : occupant.status === "active" ? (
              <Badge tone="amber">No room</Badge>
            ) : (
              <Badge>Moved out</Badge>
            )}
            {client && (
              <Link className="underline" href={`/clients/${client.id}`}>
                {client.name}
              </Link>
            )}
            {occupant.employeeId && <span>Employee ID {occupant.employeeId}</span>}
            {occupant.position && <span>{occupant.position}</span>}
            {CAN.viewBilling.includes(user.role) && (
              <Link className="underline" href={`/billing/tenants/${occupant.id}`}>
                Charges and payments
              </Link>
            )}
          </span>
        }
      />

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <Card>
            <SectionTitle>{current && current.a.checkIn > today ? "Reserved room" : "Current room"}</SectionTitle>
            {current ? (
              <div className="space-y-4">
                <dl className="grid gap-4 sm:grid-cols-3">
                  <Detail label="Room">
                    <Link className="underline" href={`/rooms/${current.a.roomId}`}>
                      {current.roomNumber}
                    </Link>
                  </Detail>
                  <Detail label="Bed">{current.a.slot}</Detail>
                  <Detail label={current.a.checkIn > today ? "Scheduled move-in" : "Moved in"}>
                    {formatDate(current.a.checkIn)}
                    {current.a.checkIn <= today && (
                      <span className="text-muted"> ({daysBetween(current.a.checkIn, today)} days ago)</span>
                    )}
                  </Detail>
                  <Detail label="Expected to move out">{current.a.expectedCheckOut ? formatDate(current.a.expectedCheckOut) : null}</Detail>
                  <Detail label="Keys and cards given" empty="None recorded">{current.a.keysIssued}</Detail>
                  <Detail label="Room given by">{current.assignedBy}</Detail>
                  <Detail label="Notes" empty="None">{current.a.notes}</Detail>
                </dl>
                {current.a.checkIn > today && <ActionForm action={cancelReservation.bind(null, current.a.id)} submitLabel="Cancel planned move-in" submitVariant="danger" confirm="Cancel this planned move-in? The reservation will be retained in audit history." />}
                <div className="space-y-2">
                  <Panel title="Move to another room">
                    <ActionForm action={transferRoom.bind(null, current.a.id)} submitLabel="Move">
                      <FormGrid>
                        <Field label="New room">
                          <Select name="roomId" required defaultValue="">
                            <option value="">Pick a room</option>
                            {rooms.map((r) => (
                              <option key={r.id} value={r.id} disabled={r.taken >= r.capacity && r.id !== current.a.roomId}>
                                {roomLabel(r)}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <Field label="Bed" hint="Optional, e.g. Bed B">
                          <Input name="slot" />
                        </Field>
                        <Field label="Date of the move">
                          <Input name="date" type="date" defaultValue={today} max={today} required />
                        </Field>
                        <Field label="Keys and cards given" hint="Leave blank to keep the current ones">
                          <Input name="keysIssued" />
                        </Field>
                        <Field label="Reason" hint="Optional" className="sm:col-span-2">
                          <Input name="reason" />
                        </Field>
                      </FormGrid>
                    </ActionForm>
                  </Panel>
                  <Panel title="Move out">
                    <ActionForm
                      action={checkOut.bind(null, current.a.id)}
                      submitLabel="Move out"
                      submitVariant="danger"
                      confirm={`Move ${occupant.fullName} out of room ${current.roomNumber}? Their bed becomes free.`}
                    >
                      <FormGrid>
                        <Field label="Move-out date">
                          <Input name="date" type="date" defaultValue={today} max={today} required />
                        </Field>
                        <Field label="Note" hint="e.g. Keys returned, room left clean">
                          <Input name="note" />
                        </Field>
                      </FormGrid>
                    </ActionForm>
                  </Panel>
                  <Panel title="Fix details of this stay">
                    <ActionForm action={editAssignment.bind(null, current.a.id)}>
                      <FormGrid>
                        <Field label="Move-in date">
                          <Input name="checkIn" type="date" defaultValue={current.a.checkIn} required />
                        </Field>
                        <Field label="Expected move-out date">
                          <Input name="expectedCheckOut" type="date" defaultValue={current.a.expectedCheckOut ?? ""} />
                        </Field>
                        <Field label="Bed">
                          <Input name="slot" defaultValue={current.a.slot ?? ""} />
                        </Field>
                        <Field label="Keys and cards given">
                          <Input name="keysIssued" defaultValue={current.a.keysIssued ?? ""} />
                        </Field>
                        <Field label="Notes" className="sm:col-span-2">
                          <Input name="assignmentNotes" defaultValue={current.a.notes ?? ""} />
                        </Field>
                      </FormGrid>
                    </ActionForm>
                  </Panel>
                </div>
              </div>
            ) : (
              <ActionForm action={assignRoom.bind(null, occupant.id)} submitLabel="Give room">
                <p className="text-sm text-muted">This tenant has no room right now. Pick one to move them in.</p>
                <StayFields rooms={rooms} />
              </ActionForm>
            )}
          </Card>

          <div>
            <SectionTitle>Rooms they have stayed in</SectionTitle>
            {history.length === 0 ? (
              <p className="text-sm text-muted">They haven&apos;t had a room yet.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Room</Th>
                    <Th>Stay</Th>
                    <Th>Notes</Th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(({ a, roomNumber }) => (
                    <tr key={a.id}>
                      <Td primary>
                        Room {roomNumber}
                        {a.slot && `, ${a.slot}`}
                      </Td>
                      <Td label="Stay" wide>
                        <StayCell checkIn={a.checkIn} actualCheckOut={a.actualCheckOut} expectedCheckOut={a.expectedCheckOut} />
                      </Td>
                      <Td label="Notes" wide className="whitespace-pre-wrap text-xs text-muted">{a.notes}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </div>

        </div>

        <div className="space-y-6 lg:col-span-2">
          {canManageLogin && (
            <Card>
              <SectionTitle actions={login && !login.active && <Badge tone="red">Turned off</Badge>}>App login for this tenant</SectionTitle>
              {login ? (
                <ActionForm action={updateTenantLogin.bind(null, occupant.id)} className="space-y-3">
                  <p className="text-sm">
                    Signs in with username <strong>{login.username}</strong> to see their room, schedules and house rules,
                    and to send requests.
                  </p>
                  <Field label="Reset password" hint="Leave blank to keep it">
                    <Input name="password" type="password" autoComplete="new-password" />
                  </Field>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="active" defaultChecked={login.active} /> Allowed to sign in
                  </label>
                </ActionForm>
              ) : (
                <ActionForm action={createTenantLogin.bind(null, occupant.id)} submitLabel="Create login">
                  <p className="text-sm text-muted">
                    Lets {occupant.fullName} sign in to see their room, maintenance visits, kitchen and laundry times,
                    house rules, and to send requests.
                  </p>
                  <FormGrid>
                    <Field label="Username">
                      <Input name="username" autoCapitalize="none" required />
                    </Field>
                    <Field label="Password" hint="At least 8 characters">
                      <Input name="password" type="password" autoComplete="new-password" required />
                    </Field>
                  </FormGrid>
                </ActionForm>
              )}
            </Card>
          )}
          <Card>
            <SectionTitle>Personal details</SectionTitle>
            <div className="space-y-5">
              {OCCUPANT_GROUPS.filter((g) => g !== "Government ID" || showIds).map((group) => (
                <div key={group}>
                  <h3 className="mb-2 border-b border-border pb-1 text-sm font-semibold">{group}</h3>
                  <dl className="grid gap-3 sm:grid-cols-2">
                    {OCCUPANT_FIELDS.filter((f) => f.group === group && f.key !== "fullName").map((f) => (
                      <Detail key={f.key} label={f.label}>
                        {f.key === "birthDate" ? (occupant.birthDate ? formatDate(occupant.birthDate) : null) : occupant[f.key]}
                      </Detail>
                    ))}
                  </dl>
                </div>
              ))}
              <Panel title="Edit personal details">
                <ActionForm action={updateOccupant.bind(null, occupant.id)}>
                  <OccupantFields occupant={occupant} clients={clients} />
                </ActionForm>
              </Panel>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
