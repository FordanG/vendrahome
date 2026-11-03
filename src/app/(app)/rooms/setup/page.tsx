import { asc } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN } from "@/lib/auth";
import { requireHotel } from "@/lib/hotel";
import { getRoomBoard } from "@/lib/rooms";
import { todayISO } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { Card, Field, Input, PageHeader, SectionTitle, Select } from "@/components/ui";
import { createRoom, saveRoomType, setPeopleAllowedMany } from "../actions";
import { RoomFields } from "../room-fields";

// Admin-only room setup, kept off the Rooms list so the list stays short on a phone.
export default async function RoomSetupPage() {
  const { hotel } = await requireHotel(CAN.manageRooms);
  const db = await getDb();
  const [rooms, roomTypes] = await Promise.all([
    getRoomBoard(todayISO(), hotel.id),
    db.select().from(schema.roomTypes).orderBy(asc(schema.roomTypes.name)),
  ]);
  const floors = [...new Set(rooms.map((r) => r.floor))];

  return (
    <>
      <PageHeader
        back={{ href: "/rooms", label: "Rooms" }}
        title="Room setup"
        subtitle="Add rooms, set room types and change how many people each room allows."
      />
        <Card>
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
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
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
                <Field label="New room type" className="w-full sm:w-auto sm:flex-1">
                  <Input name="name" placeholder="e.g. Loft, Deluxe twin" required />
                </Field>
                <Field label="People allowed" className="w-32">
                  <Input name="defaultCapacity" type="number" min={1} max={20} defaultValue={1} />
                </Field>
              </ActionForm>
            </div>
          </Card>
        </div>
    </>
  );
}
