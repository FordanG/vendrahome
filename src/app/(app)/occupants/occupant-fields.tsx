import type { Occupant } from "@/db/schema";
import { OCCUPANT_FIELDS, OCCUPANT_GROUPS, type OccupantFieldKey } from "@/lib/occupants";
import type { RoomOption } from "@/lib/assignments";
import { todayISO } from "@/lib/format";
import { Field, Input, Select, Textarea } from "@/components/ui";

/** Shown up front; the rest of the details fold away as optional. */
const QUICK: readonly OccupantFieldKey[] = ["fullName", "mobile"];

function fieldFor(key: OccupantFieldKey, occupant?: Occupant) {
  const f = OCCUPANT_FIELDS.find((x) => x.key === key)!;
  const value = occupant?.[f.key] ?? "";
  const wide = "wide" in f && f.wide;
  const required = "required" in f && f.required;
  const hint = "hint" in f ? f.hint : required ? undefined : key === "mobile" ? "Optional" : undefined;
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
        <Input name={f.key} type={"type" in f ? f.type : "text"} defaultValue={value} required={required} />
      )}
    </Field>
  );
}

export function OccupantFields({
  occupant,
  clients,
  defaultClientId,
}: {
  occupant?: Occupant;
  clients: { id: string; name: string }[];
  defaultClientId?: string;
}) {
  const hasMore = OCCUPANT_FIELDS.some((f) => !QUICK.includes(f.key) && occupant?.[f.key]);
  return (
    <div className="space-y-6">
      <fieldset>
        <legend className="mb-3 text-sm font-semibold">Name and phone</legend>
        <div className="grid gap-4 sm:grid-cols-2">{QUICK.map((key) => fieldFor(key, occupant))}</div>
      </fieldset>
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
      {/* Short stays often need nothing more than a name; everything else is optional and folds away. */}
      <details open={hasMore} className="group rounded-xl border border-border">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 hover:bg-subtle [&::-webkit-details-marker]:hidden">
          <span>
            <span className="block text-sm font-semibold">More details</span>
            <span className="block text-xs text-muted">Optional. Birth date, ID, work, emergency contact and more, for longer stays.</span>
          </span>
          <span className="text-sm font-medium text-muted group-open:hidden">Show</span>
          <span className="hidden text-sm font-medium text-muted group-open:inline">Hide</span>
        </summary>
        <div className="space-y-6 border-t border-border px-4 pb-4 pt-4">
          {OCCUPANT_GROUPS.map((group) => {
            const fields = OCCUPANT_FIELDS.filter((f) => f.group === group && !QUICK.includes(f.key));
            if (fields.length === 0) return null;
            return (
              <fieldset key={group}>
                <legend className="mb-3 text-sm font-semibold">{group}</legend>
                <div className="grid gap-4 sm:grid-cols-2">{fields.map((f) => fieldFor(f.key, occupant))}</div>
              </fieldset>
            );
          })}
        </div>
      </details>
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
      <Field label="Move-in date">
        <Input name="checkIn" type="date" defaultValue={todayISO()} />
      </Field>
      <Field label="Expected move-out date" hint="Optional">
        <Input name="expectedCheckOut" type="date" />
      </Field>
      {/* Bed, keys and notes are optional extras; folded so a quick stay is three fields on a phone. */}
      <details className="group rounded-xl border border-border sm:col-span-2">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 hover:bg-subtle [&::-webkit-details-marker]:hidden">
          <span>
            <span className="block text-sm font-semibold">Bed, keys and notes</span>
            <span className="block text-xs text-muted">Optional</span>
          </span>
          <span className="text-sm font-medium text-muted group-open:hidden">Show</span>
          <span className="hidden text-sm font-medium text-muted group-open:inline">Hide</span>
        </summary>
        <div className="grid gap-4 border-t border-border p-4 sm:grid-cols-2">
          <Field label="Bed" hint="e.g. Bed A, Upper bunk">
            <Input name="slot" />
          </Field>
          <Field label="Keys and cards issued" hint="e.g. 1 room key, 1 key card #0412">
            <Input name="keysIssued" />
          </Field>
          <Field label="Notes about this stay" className="sm:col-span-2">
            <Input name="assignmentNotes" />
          </Field>
        </div>
      </details>
    </div>
  );
}
