import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { requestScope } from "@/lib/service-work";
import { getDb, schema } from "@/db";
import { CAN, requireStaff } from "@/lib/auth";
import { roomInReach } from "@/lib/hotel";
import { getRoomBoard } from "@/lib/rooms";
import { CONDITION_LABELS, STATUS_LABELS, STATUS_TONES } from "@/lib/room-status";
import { bedsTaken, formatDate, todayISO } from "@/lib/format";
import { StayCell } from "@/components/stay";
import { REQUEST_KIND_LABELS, REQUEST_STATUS_TONES, requestStatusLabel } from "@/lib/portal";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Detail, Empty, Field, PageHeader, SectionTitle, Select, Table, Td, Th } from "@/components/ui";
import { startCleaningHere } from "../../housekeeping/actions";
import { startRunHere } from "../../maintenance/checklists/actions";
import { roomChecklists } from "@/lib/checklists";
import { deleteRoom, replaceDoorCode, setRoomCondition, updateRoom } from "../actions";
import { qrSvg, roomScanUrl } from "@/lib/room-qr";
import { everyLabel, lastCleanedLabel, roomCleaning } from "@/lib/housekeeping";
import { RoomFields } from "../room-fields";

/** Starting here skips the door code, so the app can't confirm anyone was at the room. */
const DoorNote = () => (
  <p className="mt-4 border-t border-border pt-3 text-xs text-muted">Not at the door? Starting here marks it as not checked in at the room.</p>
);

export default async function RoomPage({ params }: PageProps<"/rooms/[id]">) {
  const user = await requireStaff();
  const { id } = await params;
  const db = await getDb();
  const room = await roomInReach(user, id);
  if (!room) notFound();

  const today = todayISO();
  const [board, roomTypes, history, requests, cleaning] = await Promise.all([
    getRoomBoard(today, room.propertyId),
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
      .leftJoin(schema.occupants, eq(schema.tenantRequests.occupantId, schema.occupants.id))
      .where(and(eq(schema.tenantRequests.roomId, id), inArray(schema.tenantRequests.status, ["pending", "approved"]), requestScope(user)))
      .orderBy(desc(schema.tenantRequests.urgent), desc(schema.tenantRequests.createdAt)),
    roomCleaning(id, today),
  ]);
  const checklists = CAN.runChecklists.includes(user.role) ? await roomChecklists(id, today) : [];
  const live = board.find((r) => r.id === id)!;
  // Current tenants and bookings show under Right now, so the history lists only finished stays.
  const past = history.filter(({ a }) => a.actualCheckOut);
  const canManage = CAN.manageRooms.includes(user.role);
  const canSeePeople = CAN.manageOccupants.includes(user.role);
  const canPrintCode = CAN.printDoorCodes.includes(user.role);
  const scanUrl = canPrintCode ? await roomScanUrl(room.qrToken) : null;
  const doorCode = scanUrl ? await qrSvg(scanUrl) : null;

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
              <Link className="link" href={`/inventory/rooms/${room.id}`}>Items in this room</Link>
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
          {requests.length > 0 && (
            <Card className="border-warn">
              <SectionTitle
                actions={
                  <Link className="text-sm text-muted link" href="/requests">
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
                      <span className="text-muted">{name ? `from ${name}` : "reported by staff"}</span>
                    </div>
                    <p className="mt-1">{r.details}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card>
            <SectionTitle>Right now</SectionTitle>
            <dl className="grid gap-4 sm:grid-cols-2">
              {canSeePeople && (
                <Detail label="Beds">
                  {live.assignableBeds > 0
                    ? `${live.assignableBeds} of ${room.capacity} free to give out`
                    : `Full, ${live.occupants.length} of ${room.capacity} taken${live.upcoming.length ? ", the rest booked" : ""}`}
                </Detail>
              )}
              {CAN.viewClients.includes(user.role) && <Detail label="Contract">
                {live.contract ? (
                  canSeePeople ? (
                    <Link className="link" href={`/contracts/${live.contract.id}`}>
                      {live.contract.clientName}, contract {live.contract.reference}
                    </Link>
                  ) : (
                    live.contract.clientName
                  )
                ) : (
                  "Not leased to anyone"
                )}
              </Detail>}
              {CAN.viewClients.includes(user.role) && <Detail label="Contract ends">{live.contract ? formatDate(live.contract.endDate) : null}</Detail>}
            </dl>
            <div className="mt-4 space-y-2">
              {live.occupants.length === 0 && <p className="text-sm text-muted">No one lives here right now.</p>}
              {live.occupants.map((o) => (
                <div key={o.assignmentId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3 text-sm">
                  <div>
                    {canSeePeople ? (
                      <Link className="font-medium link" href={`/occupants/${o.occupantId}`}>
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
            <ActionForm
              action={setRoomCondition.bind(null, room.id)}
              submitLabel="Update"
              submitVariant="secondary"
              className="mt-5 flex flex-wrap items-end gap-3 border-t border-border pt-4"
            >
              <Field label="Condition" className="min-w-48 flex-1">
                <Select name="condition" defaultValue={room.condition}>
                  {Object.entries(CONDITION_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              </Field>
            </ActionForm>
            <p className="mt-2 text-xs text-muted">Shows on the room board. Use Needs attention for repairs or cleaning.</p>
          </Card>

          {(checklists.length > 0 || CAN.cleanRooms.includes(user.role)) && (
            <Card>
              <SectionTitle>Checks and cleaning</SectionTitle>
              <dl className="grid gap-4 sm:grid-cols-2">
                {checklists.length > 0 && (
                  <Detail label="Maintenance checklists">
                    <ul className="space-y-2">
                      {checklists.map((c) => (
                        <li key={c.checklist.id}>
                          {c.checklist.name}
                          <span className={`block text-xs ${c.daysLate > 0 ? "text-attention" : "text-muted"}`}>
                            {c.due > today ? `Next due ${formatDate(c.due)}` : c.daysLate > 0 ? `${c.daysLate} days overdue` : "Due today"}
                          </span>
                          {c.due <= today && (
                            <ActionForm
                              action={async () => {
                                "use server";
                                return startRunHere(room.id, c.checklist.id);
                              }}
                              submitLabel="Start check"
                              pendingLabel="Opening…"
                              submitVariant="secondary"
                              className="mt-1"
                            />
                          )}
                        </li>
                      ))}
                    </ul>
                  </Detail>
                )}
                <Detail label="Cleaning">
                  {everyLabel(cleaning.every)}
                  <span className="block text-xs text-muted">
                    {lastCleanedLabel(cleaning.lastCleaned, today)}
                    {cleaning.next && `. Next ${cleaning.next === today ? "today" : formatDate(cleaning.next)}`}
                  </span>
                  {CAN.cleanRooms.includes(user.role) && (
                    <ActionForm
                      action={async () => {
                        "use server";
                        return startCleaningHere(room.id);
                      }}
                      submitLabel="Start cleaning"
                      pendingLabel="Opening…"
                      submitVariant="secondary"
                      className="mt-2"
                    />
                  )}
                </Detail>
              </dl>
              {(checklists.some((c) => c.due <= today) || CAN.cleanRooms.includes(user.role)) && <DoorNote />}
            </Card>
          )}

          {canSeePeople && (
            <div>
              <SectionTitle>Past tenants</SectionTitle>
              {past.length === 0 ? (
                <Empty>{history.length === 0 ? "No one has stayed in this room yet." : "No one has moved out of this room yet."}</Empty>
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
                    {past.map(({ a, name }) => (
                      <tr key={a.id}>
                        <Td primary>
                          <Link className="link" href={`/occupants/${a.occupantId}`}>
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
          {doorCode && (
            <Card>
              <SectionTitle
                actions={
                  <Link className="text-sm text-muted link" href={`/rooms/door-codes?room=${room.id}`}>
                    Print
                  </Link>
                }
              >
                Door code
              </SectionTitle>
              <div className="mx-auto w-40 bg-white p-1" dangerouslySetInnerHTML={{ __html: doorCode }} />
              <p className="mt-3 text-xs text-muted">
                Tenants scan it to ask for help. Staff scan it to check in at the room. Its address is{" "}
                <a className="break-all link" href={scanUrl!}>{scanUrl}</a>
              </p>
              {canManage && (
                <div className="mt-4 border-t border-border pt-4">
                  <ActionForm
                    action={async () => {
                      "use server";
                      return replaceDoorCode(room.id);
                    }}
                    submitLabel="Make a new code"
                    submitVariant="secondary"
                    confirm={`Make a new code for room ${room.number}? The code on the door stops working until you replace it.`}
                  />
                  <p className="mt-2 text-xs text-muted">Use this if the printed code was copied or shared.</p>
                </div>
              )}
            </Card>
          )}

          {canManage && (
            <Card>
              <details className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
                  <span>
                    <span className="block text-base font-semibold tracking-tight">Edit room</span>
                    <span className="block text-xs text-muted">Number, floor, type, people allowed and notes</span>
                  </span>
                  <span className="text-sm font-medium text-muted group-open:hidden">Show</span>
                  <span className="hidden text-sm font-medium text-muted group-open:inline">Hide</span>
                </summary>
                <ActionForm action={updateRoom.bind(null, room.id)} className="mt-4">
                  <RoomFields roomTypes={roomTypes} room={room} />
                </ActionForm>
                {history.length === 0 && (
                  <div className="mt-5 border-t border-border pt-4">
                    <ActionForm
                      action={async () => {
                        "use server";
                        return deleteRoom(room.id);
                      }}
                      submitLabel="Delete room"
                      submitVariant="danger"
                      confirm={`Delete room ${room.number}? This can't be undone.`}
                    />
                    <p className="mt-2 text-xs text-muted">Only rooms no one has stayed in can be deleted.</p>
                  </div>
                )}
              </details>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
