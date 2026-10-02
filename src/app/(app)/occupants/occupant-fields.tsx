import type { Occupant } from "@/db/schema";
import { OCCUPANT_FIELDS, OCCUPANT_GROUPS } from "@/lib/occupants";
import type { RoomOption } from "@/lib/assignments";
import { todayISO } from "@/lib/format";
import { Field, Input, Select, Textarea } from "@/components/ui";

export function OccupantFields({
  occupant,
  clients,
  defaultClientId,
}: {
  occupant?: Occupant;
  clients: { id: string; name: string }[];
  defaultClientId?: string;
}) {
  return (
    <div className="space-y-6">
      <fieldset>
        <legend className="mb-3 text-sm font-semibold">Company</legend>
        <Field label="Company" hint="The company this tenant works for, which pays for the room">
          <Select name="clientId" defaultValue={occupant?.clientId ?? defaultClientId ?? clients[0]?.id ?? ""}>
            <option value="">No company (pays on their own)</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      </fieldset>
      {OCCUPANT_GROUPS.map((group) => (
        <fieldset key={group}>
          <legend className="mb-3 text-sm font-semibold">{group}</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            {OCCUPANT_FIELDS.filter((f) => f.group === group).map((f) => {
              const value = occupant?.[f.key] ?? "";
              const wide = "wide" in f && f.wide;
              const hint = "hint" in f ? f.hint : undefined;
              return (
                <Field key={f.key} label={f.label} hint={hint} className={wide ? "sm:col-span-2" : undefined}>
                  {"options" in f ? (
                    <Select name={f.key} defaultValue={value}>
                      <option value="">Not set</option>
                      {f.options.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </Select>
                  ) : "textarea" in f ? (
                    <Textarea name={f.key} defaultValue={value} />
                  ) : (
                    <Input
                      name={f.key}
                      type={"type" in f ? f.type : "text"}
                      defaultValue={value}
                      required={"required" in f && f.required}
                    />
                  )}
                </Field>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

export function roomLabel(r: RoomOption) {
  const free = r.capacity - r.taken;
  return `Room ${r.number}, floor ${r.floor} (${free > 0 ? `${free} of ${r.capacity} beds free` : "full"})`;
}

/** Room, bed, dates and keys for a new stay. */
export function StayFields({
  rooms,
  defaultRoomId,
  optional,
}: {
  rooms: RoomOption[];
  defaultRoomId?: string;
  optional?: boolean;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Room" hint={optional ? "Leave blank to give them a room later." : undefined}>
        <Select name="roomId" defaultValue={defaultRoomId ?? ""} required={!optional}>
          <option value="">{optional ? "No room yet" : "Pick a room"}</option>
          {rooms.map((r) => (
            <option key={r.id} value={r.id} disabled={r.taken >= r.capacity}>
              {roomLabel(r)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Bed" hint="Optional, e.g. Bed A, Upper bunk">
        <Input name="slot" />
      </Field>
      <Field label="Move-in date">
        <Input name="checkIn" type="date" defaultValue={todayISO()} />
      </Field>
      <Field label="Expected move-out date" hint="Optional">
        <Input name="expectedCheckOut" type="date" />
      </Field>
      <Field label="Keys and cards issued" hint="e.g. 1 room key, 1 key card #0412">
        <Input name="keysIssued" />
      </Field>
      <Field label="Notes about this stay" hint="Optional">
        <Input name="assignmentNotes" />
      </Field>
    </div>
  );
}
