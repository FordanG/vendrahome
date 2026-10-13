import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireCompany } from "@/lib/auth";
import { openAssignmentFor } from "@/lib/assignments";
import { companyOccupant, companyRooms, STAY_REQUEST_LABELS, STAY_REQUEST_STATUS_LABELS, STAY_REQUEST_STATUS_TONES } from "@/lib/company";
import { formatDate, formatMoment, stayRange, todayISO } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Detail, Field, Input, PageHeader, SectionTitle, Select } from "@/components/ui";
import { askMoveIn, askMoveOut, cancelStayRequest, createPersonLogin, savePerson, updatePersonLogin } from "../../actions";
import { PersonFields } from "../person-fields";

export default async function CompanyPersonPage({ params }: PageProps<"/company/people/[id]">) {
  const { client } = await requireCompany();
  const { id } = await params;
  const person = await companyOccupant(client.id, id);
  if (!person) notFound();
  const today = todayISO();
  const db = await getDb();
  const [stay, asks, login, rooms] = await Promise.all([
    openAssignmentFor(person.id),
    db
      .select({ s: schema.stayRequests, number: schema.rooms.number })
      .from(schema.stayRequests)
      .leftJoin(schema.rooms, eq(schema.stayRequests.roomId, schema.rooms.id))
      .where(and(eq(schema.stayRequests.occupantId, person.id), eq(schema.stayRequests.clientId, client.id)))
      .orderBy(desc(schema.stayRequests.createdAt))
      .limit(10),
    db.query.staff.findFirst({ where: and(eq(schema.staff.occupantId, person.id), eq(schema.staff.role, "tenant")) }),
    companyRooms(client.id, today),
  ]);
  const stayRoom = stay ? await db.query.rooms.findFirst({ where: eq(schema.rooms.id, stay.roomId) }) : null;
  const pending = asks.find((a) => a.s.status === "pending");
  const canEdit = client.selfManagePeople;
  const openRooms = rooms.filter((r) => r.free > 0);
  const fullRooms = rooms.filter((r) => r.free === 0);
  // The hotel's name only helps when the company leases in more than one.
  const manyHotels = new Set(rooms.map((r) => r.hotel)).size > 1;

  return (
    <>
      <PageHeader
        back={{ href: "/company/people", label: "People" }}
        title={person.fullName}
        subtitle={[person.position, person.department, person.employeeId && `Employee ID ${person.employeeId}`].filter(Boolean).join(", ") || undefined}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:order-2">
          <Card>
            <SectionTitle>Room</SectionTitle>
            {stay && stayRoom ? (
              <dl className="space-y-3">
                <Detail label="Room">
                  Room {stayRoom.number}
                  {stay.slot && `, ${stay.slot}`}
                </Detail>
                <Detail label="Stay">{stayRange(stay.checkIn, stay.expectedCheckOut)}</Detail>
              </dl>
            ) : (
              <p className="text-sm text-muted">No room right now.</p>
            )}

            {pending ? (
              <div className="mt-4 border-t border-border pt-4">
                <p className="text-sm">
                  <Badge tone="amber">{STAY_REQUEST_LABELS[pending.s.kind]} asked</Badge>{" "}
                  {pending.s.kind === "move_in" ? `Room ${pending.number}, ` : ""}
                  {formatDate(pending.s.date)}. Waiting for the front desk.
                </p>
                <ActionForm
                  action={async () => {
                    "use server";
                    return cancelStayRequest(pending.s.id);
                  }}
                  submitLabel="Cancel this ask"
                  submitVariant="secondary"
                  className="mt-3 space-y-3"
                />
              </div>
            ) : stay ? (
              <details className="mt-4 border-t border-border pt-4">
                <summary className="cursor-pointer text-sm font-medium">Ask for a move-out</summary>
                <ActionForm action={askMoveOut.bind(null, person.id)} submitLabel="Send to the front desk" pendingLabel="Sending…" className="mt-3 space-y-3">
                  <Field label="Leaving on">
                    <Input name="date" type="date" defaultValue={stay.expectedCheckOut ?? today} min={stay.checkIn} required />
                  </Field>
                  <Field label="Note" hint="Optional, e.g. end of assignment">
                    <Input name="note" maxLength={1000} />
                  </Field>
                </ActionForm>
              </details>
            ) : (
              <div className="mt-4 border-t border-border pt-4">
                <h3 className="mb-3 text-sm font-medium">Ask for a room</h3>
                {rooms.every((r) => r.free === 0) ? (
                  <p className="text-sm text-muted">Every bed under your contract is taken.</p>
                ) : (
                  <ActionForm action={askMoveIn.bind(null, person.id)} submitLabel="Send to the front desk" pendingLabel="Sending…" className="space-y-3">
                    <Field label="Room">
                      <Select name="roomId" required defaultValue="">
                        <option value="">Pick a room ({openRooms.length} with a free bed)</option>
                        {/* Rooms with a free bed first; full ones after, greyed out, so the list stays honest but short to scan. */}
                        <optgroup label="Free beds">
                          {openRooms.map(({ room, hotel, free }) => (
                            <option key={room.id} value={room.id}>
                              {manyHotels ? `${hotel}, room` : "Room"} {room.number}, floor {room.floor}, {free} {free === 1 ? "bed" : "beds"} free
                            </option>
                          ))}
                        </optgroup>
                        {fullRooms.length > 0 && (
                          <optgroup label="Full">
                            {fullRooms.map(({ room, hotel }) => (
                              <option key={room.id} value={room.id} disabled>
                                {manyHotels ? `${hotel}, room` : "Room"} {room.number}, full
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </Select>
                    </Field>
                    <Field label="Bed" hint="Optional, e.g. Bed A">
                      <Input name="slot" />
                    </Field>
                    <Field label="Moving in on">
                      <Input name="date" type="date" defaultValue={today} min={today} required />
                    </Field>
                    <Field label="Expected move-out" hint="Optional">
                      <Input name="expectedCheckOut" type="date" min={today} />
                    </Field>
                    <Field label="Note" hint="Optional, e.g. arrival time">
                      <Input name="note" maxLength={1000} />
                    </Field>
                  </ActionForm>
                )}
              </div>
            )}
          </Card>

          <Card>
            <SectionTitle>Tenant login</SectionTitle>
            {login ? (
              canEdit ? (
                <ActionForm action={updatePersonLogin.bind(null, person.id)}>
                  <p className="text-sm">
                    Signs in as <span className="font-medium">{login.username}</span>
                    {!login.active && <span className="text-attention">, turned off</span>}
                  </p>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="active" defaultChecked={login.active} /> Can sign in
                  </label>
                  <Field label="New password" hint="Leave blank to keep the current one">
                    <Input name="password" type="password" autoComplete="new-password" />
                  </Field>
                </ActionForm>
              ) : (
                <p className="text-sm">
                  Signs in as <span className="font-medium">{login.username}</span>
                  {!login.active && ", turned off"}
                </p>
              )
            ) : canEdit ? (
              <ActionForm action={createPersonLogin.bind(null, person.id)} submitLabel="Create login" resetOnSuccess>
                <p className="text-sm text-muted">Lets them see their room, send requests and follow their laundry on their phone.</p>
                <Field label="Username">
                  <Input name="username" autoCapitalize="none" autoComplete="off" required />
                </Field>
                <Field label="Password" hint="At least 8 characters. Give it to them in person.">
                  <Input name="password" type="password" autoComplete="new-password" required />
                </Field>
              </ActionForm>
            ) : (
              <p className="text-sm text-muted">No login yet. The front desk creates tenant logins.</p>
            )}
          </Card>

          {asks.some((a) => a.s.status !== "pending") && (
            <Card>
              <SectionTitle>Earlier asks</SectionTitle>
              <ul className="space-y-3 text-sm">
                {asks
                  .filter((a) => a.s.status !== "pending")
                  .map(({ s, number }) => (
                    <li key={s.id}>
                      <span className="flex flex-wrap items-center gap-2">
                        {STAY_REQUEST_LABELS[s.kind]}
                        {number && `, room ${number}`}, {formatDate(s.date)}
                        <Badge tone={STAY_REQUEST_STATUS_TONES[s.status]}>{STAY_REQUEST_STATUS_LABELS[s.status]}</Badge>
                      </span>
                      {s.response && <span className="block text-muted">{s.response}</span>}
                      {s.handledAt && <span className="block text-xs text-muted">{formatMoment(s.handledAt)}</span>}
                    </li>
                  ))}
              </ul>
            </Card>
          )}
        </div>

        <Card className="min-w-0 lg:order-1 lg:col-span-2">
          <SectionTitle>Details</SectionTitle>
          {canEdit ? (
            <ActionForm action={savePerson.bind(null, person.id)}>
              <PersonFields occupant={person} />
            </ActionForm>
          ) : (
            <>
              <p className="mb-4 text-sm text-muted">The front desk keeps these details. Ask them for changes.</p>
              <PersonFields occupant={person} readOnly />
            </>
          )}
        </Card>
      </div>
    </>
  );
}
