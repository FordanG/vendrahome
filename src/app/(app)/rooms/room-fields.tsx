import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui";

type RoomType = { id: string; name: string; defaultCapacity: number };

export function RoomFields({
  roomTypes,
  room,
}: {
  roomTypes: RoomType[];
  room?: { number: string; floor: number; capacity: number; roomTypeId: string | null; notes: string | null };
}) {
  return (
    <FormGrid>
      <Field label="Room number">
        <Input name="number" defaultValue={room?.number} required />
      </Field>
      <Field label="Floor">
        <Input name="floor" type="number" defaultValue={room?.floor} required />
      </Field>
      <Field label="Room type">
        <Select name="roomTypeId" defaultValue={room?.roomTypeId ?? roomTypes[0]?.id ?? ""}>
          <option value="">No type</option>
          {roomTypes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="People allowed" hint="How many people can live in this room (one bed each)">
        <Input name="capacity" type="number" min={1} max={20} defaultValue={room?.capacity ?? 1} required />
      </Field>
      <Field label="Notes" className="sm:col-span-2">
        <Textarea name="notes" defaultValue={room?.notes ?? ""} />
      </Field>
    </FormGrid>
  );
}
