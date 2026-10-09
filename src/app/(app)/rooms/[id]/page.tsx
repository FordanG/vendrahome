import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { requestScope } from "@/lib/service-work";
import { getDb, schema } from "@/db";
import { CAN, requireStaff } from "@/lib/auth";
import { getRoomBoard } from "@/lib/rooms";
import { CONDITION_LABELS, STATUS_LABELS, STATUS_TONES } from "@/lib/room-status";
import { bedsTaken, formatDate, todayISO } from "@/lib/format";
import { StayCell } from "@/components/stay";
import { REQUEST_KIND_LABELS, REQUEST_STATUS_TONES, requestStatusLabel } from "@/lib/portal";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Detail, Empty, Field, Input, PageHeader, SectionTitle, Select, Table, Td, Th } from "@/components/ui";
import { deleteRoom, setPeopleAllowed, setRoomCondition, updateRoom } from "../actions";
import { RoomFields } from "../room-fields";

export default async function RoomPage({ params }: PageProps<"/rooms/[id]">) {
  const user = await requireStaff();
  const { id } = await params;
  const db = await getDb();
  const room = await db.query.rooms.findFirst({ where: eq(schema.rooms.id, id) });
  if (!room) notFound();

  const today = todayISO();
  const [board, roomTypes, history, requests] = await Promise.all([
    getRoomBoard(today),
    db.select().from(schema.roomTypes).orderBy(asc(schema.roomTypes.name)),
    db
      .select({ a: schema.roomAssignments, name: schema.occupants.fullName })
      .from(schema.roomAssignments)
      .innerJoin(schema.occupants, eq(schema.roomAssignments.occupantId, schema.occupants.id))
      .where(eq(schema.roomAssignments.roomId, id))
      .orderBy(desc(schema.roomAssignments.checkIn)),
    db
      .select({ r: schema.tenantRequests, name: schema.occupants.fullName })
      .from(schema.tenantRequests)
      .innerJoin(schema.occupants, eq(schema.tenantRequests.occupantId, schema.occupants.id))
      .where(and(eq(schema.tenantRequests.roomId, id), inArray(schema.tenantRequests.status, ["pending", "approved"]), requestScope(user)))
      .orderBy(desc(schema.tenantRequests.urgent), desc(schema.tenantRequests.createdAt)),
  ]);
  const live = board.find((r) => r.id === id)!;
  const canManage = CAN.manageRooms.includes(user.role);
  const canSeePeople = CAN.manageOccupants.includes(user.role);

  return (
    <>
      <PageHeader
        back={{ href: "/rooms", label: "Rooms" }}
        title={`Room ${room.number}`}
        subtitle={
          <span className="inline-flex items-center gap-2">
            <Badge tone={STATUS_TONES[live.status]}>{STATUS_LABELS[live.status]}</Badge>
            Floor {room.floor}, {live.typeName ?? "no room type set"}, {bedsTaken(live.occupants.length, room.capacity)}
            {CAN.viewInventory.includes(user.role) && (
              <Link className="underline underline-offset-2" href={`/inventory/rooms/${room.id}`}>Items in this room</Link>
            )}
          </span>
        }
        actions={
          canSeePeople &&
          live.assignableBeds > 0 && (
            <Link
              href={`/assignments/new?room=${room.id}`}
              className="rounded-md bg-accent px-3.5 py-2 text-sm font-medium text-accent-foreground"
            >
              Add a tenant to this room
            </Link>
          )
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <SectionTitle>Right now</SectionTitle>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Detail label="Beds available to assign">{live.assignableBeds}</Detail>
              <Detail label="Condition">{CONDITION_LABELS[room.condition]}</Detail>
              <Detail label="Contract">
                {live.contract ? (
                  canSeePeople ? (
                    <Link className="underline" href={`/contracts/${live.contract.id}`}>
                      {live.contract.clientName}, contract {live.contract.reference}
                    </Link>
                  ) : (
                    live.contract.clientName
                  )
                ) : (
                  "Not leased to anyone"
                )}
              </Detail>
              <Detail label="Contract ends">{live.contract ? formatDate(live.contract.endDate) : null}</Detail>
            </dl>
            <div className="mt-4 space-y-2">
              {live.occupants.length === 0 && <p className="text-sm text-muted">No one lives here right now.</p>}
              {live.occupants.map((o) => (
                <div key={o.assignmentId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3 text-sm">
                  <div>
                    {canSeePeople ? (
                      <Link className="font-medium underline" href={`/occupants/${o.occupantId}`}>
                        {o.fullName}
                      </Link>
                    ) : (
                      <span className="font-medium">{o.fullName}</span>
                    )}
                    {o.slot && <span className="text-muted">, {o.slot}</span>}
                    <p className="text-xs text-muted">
                      Moved in {formatDate(o.checkIn)}
                      {o.expectedCheckOut && `. Expected to move out ${formatDate(o.expectedCheckOut)}.`}
                    </p>
                  </div>
                </div>
              ))}
              {live.upcoming.map((o) => (
                <p key={o.assignmentId} className="text-sm text-muted">
                  {o.fullName} moves in {formatDate(o.checkIn)}
                </p>
              ))}
            </div>
          </Card>

          {requests.length > 0 && (
            <Card className="border-warn">
              <SectionTitle
                actions={
                  <Link className="text-sm text-muted underline underline-offset-2" href="/requests">
                    All requests
                  </Link>
                }
              >
                Open requests from tenants
              </SectionTitle>
              <ul className="divide-y divide-border text-sm">
                {requests.map(({ r, name }) => (
                  <li key={r.id} className="py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{REQUEST_KIND_LABELS[r.kind]}</span>
                      <Badge tone={REQUEST_STATUS_TONES[r.status]}>{requestStatusLabel(r)}</Badge>
                      {r.urgent && <Badge tone="red">Urgent</Badge>}
                      <span className="text-muted">from {name}</span>
                    </div>
                    <p className="mt-1">{r.details}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {canSeePeople && (
            <div>
              <SectionTitle>Everyone who has stayed here</SectionTitle>
              {history.length === 0 ? (
                <Empty>No one has stayed in this room yet.</Empty>
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>Tenant</Th>
                      <Th>Bed</Th>
                      <Th>Stay</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map(({ a, name }) => (
                      <tr key={a.id}>
                        <Td primary>
                          <Link className="underline" href={`/occupants/${a.occupantId}`}>
                            {name}
                          </Link>
                        </Td>
                        <Td label="Bed">{a.slot ?? <span className="text-muted">Not set</span>}</Td>
                        <Td label="Stay" wide>
                          <StayCell checkIn={a.checkIn} actualCheckOut={a.actualCheckOut} expectedCheckOut={a.expectedCheckOut} />
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </div>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <SectionTitle>People allowed</SectionTitle>
            <p className="mb-3 text-sm">
              <span className="plate text-3xl font-bold">{room.capacity}</span>{" "}
              <span className="text-muted">
                {room.capacity === 1 ? "person" : "people"} can live here. {live.occupants.length} living here now
                {live.upcoming.length > 0 && `, ${live.upcoming.length} moving in soon`}.
              </span>
            </p>
            {canManage ? (
              <ActionForm action={setPeopleAllowed.bind(null, room.id)} submitLabel="Save" className="flex flex-wrap items-end gap-3">
                <Field label="Change to" hint="One bed per person">
                  <Input name="capacity" type="number" min={1} max={20} defaultValue={room.capacity} required className="w-24" />
                </Field>
              </ActionForm>
            ) : (
              <p className="text-xs text-muted">Only the admin can change this.</p>
            )}
          </Card>

          <Card>
            <SectionTitle>Condition</SectionTitle>
            <ActionForm action={setRoomCondition.bind(null, room.id)} submitLabel="Update">
              <Field label="Room condition" hint="Shows on the room board. Use Needs attention for repairs or cleaning.">
                <Select name="condition" defaultValue={room.condition}>
                  {Object.entries(CONDITION_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              </Field>
            </ActionForm>
          </Card>

          {canManage && (
            <Card>
              <SectionTitle>Room details</SectionTitle>
              <ActionForm action={updateRoom.bind(null, room.id)}>
                <RoomFields roomTypes={roomTypes} room={room} />
              </ActionForm>
            </Card>
          )}

          {canManage && history.length === 0 && (
            <Card>
              <SectionTitle>Delete room</SectionTitle>
              <ActionForm
                action={async () => {
                  "use server";
                  return deleteRoom(room.id);
                }}
                submitLabel="Delete room"
                submitVariant="danger"
                confirm={`Delete room ${room.number}? This can't be undone.`}
              />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
