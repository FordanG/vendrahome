import Link from "next/link";
import { asc } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN, requireStaff } from "@/lib/auth";
import { getRoomBoard } from "@/lib/rooms";
import { STATUS_LABELS, STATUS_TONES } from "@/lib/room-status";
import { bedsTaken, todayISO } from "@/lib/format";
import { FloorJump, Row, RowLine, RowList, RoomPlate } from "@/components/list";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Field, Input, PageHeader, SectionTitle, Select, Table, Td, Th } from "@/components/ui";
import { createRoom, saveRoomType, setPeopleAllowedMany } from "./actions";
import { RoomFields } from "./room-fields";

export default async function RoomsPage() {
  const user = await requireStaff();
  const canManage = CAN.manageRooms.includes(user.role);
  const db = await getDb();
  const [rooms, roomTypes] = await Promise.all([
    getRoomBoard(todayISO()),
    db.select().from(schema.roomTypes).orderBy(asc(schema.roomTypes.name)),
  ]);
  const floors = [...new Set(rooms.map((r) => r.floor))];
  // With one company leasing everything, "Leased to" on every row is just noise.
  const manyCompanies = new Set(rooms.map((r) => r.contract?.clientName).filter(Boolean)).size > 1;

  return (
    <>
      <PageHeader title="Rooms" subtitle={`${rooms.length} rooms. Open a room to see who lives there and change its details.`} />

      <FloorJump floors={floors} />
      <div className="space-y-5 sm:hidden">
        {floors.map((f) => (
          <section key={f} id={`floor-${f}`} className="floor-section" aria-label={`Floor ${f}`}>
            <h2 className="mb-2 text-sm font-semibold text-muted">Floor {f}</h2>
            <RowList>
              {rooms
                .filter((r) => r.floor === f)
                .map((r) => (
                  <Row
                    key={r.id}
                    href={`/rooms/${r.id}`}
                    plate={<RoomPlate number={r.number} status={r.status} />}
                    title={STATUS_LABELS[r.status]}
                  >
                    <RowLine>{[r.typeName, bedsTaken(r.occupants.length, r.capacity)].filter(Boolean).join(", ")}</RowLine>
                    {manyCompanies && r.contract && <RowLine>Leased to {r.contract.clientName}</RowLine>}
                  </Row>
                ))}
            </RowList>
          </section>
        ))}
      </div>

      <div className="hidden sm:block">
        <Table>
          <thead>
            <tr>
              <Th>Room</Th>
              <Th>Floor</Th>
              <Th>Type</Th>
              <Th>People allowed</Th>
              <Th>Status</Th>
              <Th>Leased to</Th>
            </tr>
          </thead>
          <tbody>
            {rooms.map((r) => (
              <tr key={r.id} className="hover:bg-background">
                <Td primary>
                  <Link href={`/rooms/${r.id}`} className="font-medium underline-offset-2 hover:underline">
                    {r.number}
                  </Link>
                </Td>
                <Td label="Floor">{r.floor}</Td>
                <Td label="Type">{r.typeName ?? <span className="text-muted">Not set</span>}</Td>
                <Td label="People allowed">
                  {r.capacity}
                  <span className="block text-xs text-muted">{r.occupants.length} living here</span>
                </Td>
                <Td label="Status">
                  <Badge tone={STATUS_TONES[r.status]}>{STATUS_LABELS[r.status]}</Badge>
                </Td>
                <Td label="Leased to" wide>{r.contract?.clientName ?? <span className="text-muted">No one</span>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>

      {canManage && (
        <Card className="mt-8">
          <SectionTitle>Change how many people are allowed</SectionTitle>
          <ActionForm action={setPeopleAllowedMany} submitLabel="Change" className="flex flex-wrap items-end gap-3">
            <Field label="Which rooms" className="w-full sm:w-64">
              <Select name="which" defaultValue="all">
                <option value="all">Every room ({rooms.length})</option>
                <optgroup label="A room type">
                  {roomTypes.map((t) => (
                    <option key={t.id} value={`type:${t.id}`}>
                      Every {t.name} room ({rooms.filter((r) => r.typeName === t.name).length})
                    </option>
                  ))}
                </optgroup>
                <optgroup label="A floor">
                  {floors.map((f) => (
                    <option key={f} value={`floor:${f}`}>
                      Floor {f} ({rooms.filter((r) => r.floor === f).length})
                    </option>
                  ))}
                </optgroup>
                <optgroup label="One room">
                  {rooms.map((r) => (
                    <option key={r.id} value={`room:${r.id}`}>
                      Room {r.number} (now {r.capacity})
                    </option>
                  ))}
                </optgroup>
              </Select>
            </Field>
            <Field label="People allowed" className="w-32">
              <Input name="capacity" type="number" min={1} max={20} defaultValue={2} required />
            </Field>
          </ActionForm>
          <p className="mt-3 text-xs text-muted">
            A room can&apos;t be set lower than the number of tenants living there. You can also change one room from
            its own page.
          </p>
        </Card>
      )}

      {canManage && (
        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <Card>
            <SectionTitle>Add a room</SectionTitle>
            <ActionForm action={createRoom} submitLabel="Add room" resetOnSuccess>
              <RoomFields roomTypes={roomTypes} />
            </ActionForm>
          </Card>
          <Card>
            <SectionTitle>Room types</SectionTitle>
            <div className="space-y-4">
              {roomTypes.map((t) => (
                <ActionForm key={t.id} action={saveRoomType.bind(null, t.id)} className="flex flex-wrap items-end gap-2">
                  <Field label="Name" className="flex-1">
                    <Input name="name" defaultValue={t.name} required />
                  </Field>
                  <Field label="People allowed" className="w-32">
                    <Input name="defaultCapacity" type="number" min={1} max={20} defaultValue={t.defaultCapacity} />
                  </Field>
                  <label className="flex w-full items-center gap-2 text-sm">
                    <input type="checkbox" name="applyToRooms" />
                    {`Also change every ${t.name} room (${rooms.filter((r) => r.typeName === t.name).length}) to this number`}
                  </label>
                </ActionForm>
              ))}
              <ActionForm action={saveRoomType.bind(null, null)} submitLabel="Add type" resetOnSuccess className="flex flex-wrap items-end gap-2 border-t border-border pt-4">
                <Field label="New room type" className="flex-1">
                  <Input name="name" placeholder="e.g. Loft, Deluxe twin" required />
                </Field>
                <Field label="People allowed" className="w-32">
                  <Input name="defaultCapacity" type="number" min={1} max={20} defaultValue={1} />
                </Field>
              </ActionForm>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
