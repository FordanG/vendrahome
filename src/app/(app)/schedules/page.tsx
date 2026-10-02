import { asc } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN, requireStaff } from "@/lib/auth";
import { formatTimeRange } from "@/lib/format";
import { daysLabel, getSchedule, groupByDays, SCHEDULE_KIND_LABELS, scheduleTargetLabel, WEEKDAYS } from "@/lib/portal";
import { ActionForm } from "@/components/action-form";
import { TargetSelect } from "@/components/target-select";
import { Card, Empty, Field, FormGrid, Input, PageHeader, SectionTitle, Select, Table, Td, Th } from "@/components/ui";
import { addScheduleEntry, removeScheduleEntries } from "./actions";

export default async function SchedulesPage() {
  const user = await requireStaff();
  const canManage = CAN.manageSchedules.includes(user.role);
  const db = await getDb();
  const [entries, rooms] = await Promise.all([
    getSchedule(),
    db
      .select({ id: schema.rooms.id, number: schema.rooms.number, floor: schema.rooms.floor })
      .from(schema.rooms)
      .orderBy(asc(schema.rooms.floor), asc(schema.rooms.number)),
  ]);

  return (
    <>
      <PageHeader
        title="Kitchen and laundry schedule"
        subtitle="The weekly timetable tenants see. Laundry outside these times needs a request."
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {(["kitchen", "laundry"] as const).map((kind) => {
            const rows = groupByDays(
              entries.filter((r) => r.e.kind === kind).map(({ e, roomNumber }) => ({ ...e, roomNumber })),
              (e) => [e.startTime, e.endTime, e.floor, e.roomId, e.note].join("|"),
            ).sort((a, b) => (a.first.floor ?? 0) - (b.first.floor ?? 0) || a.first.startTime.localeCompare(b.first.startTime));
            return (
              <section key={kind}>
                <SectionTitle>{SCHEDULE_KIND_LABELS[kind]}</SectionTitle>
                {rows.length === 0 ? (
                  <Empty>No {SCHEDULE_KIND_LABELS[kind].toLowerCase()} times yet. Add them with the form.</Empty>
                ) : (
                  <Table>
                    <thead>
                      <tr>
                        <Th>For</Th>
                        <Th>Days</Th>
                        <Th>Time</Th>
                        <Th>Note</Th>
                        {canManage && <Th />}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(({ first: e, days, entries: list }) => (
                        <tr key={e.id}>
                          <Td primary className="font-medium align-middle">{scheduleTargetLabel(e, e.roomNumber)}</Td>
                          <Td label="Days">{daysLabel(days)}</Td>
                          <Td label="Time" className="whitespace-nowrap">{formatTimeRange(e.startTime, e.endTime)}</Td>
                          <Td label="Note" wide className="text-muted">{e.note}</Td>
                          {canManage && (
                            <Td className="text-right">
                              <ActionForm
                                action={removeScheduleEntries.bind(null, list.map((x) => x.id))}
                                submitLabel="Remove"
                                pendingLabel="Removing…"
                                submitVariant="ghost"
                                confirm={`Remove ${e.note ?? "this slot"} (${daysLabel(days)})?`}
                              />
                            </Td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </section>
            );
          })}
        </div>

        {canManage && (
          <Card className="self-start">
            <SectionTitle>Add time slots</SectionTitle>
            <ActionForm action={addScheduleEntry} submitLabel="Add" resetOnSuccess>
              <Field label="Kitchen or laundry">
                <Select name="kind" defaultValue="kitchen">
                  <option value="kitchen">{SCHEDULE_KIND_LABELS.kitchen}</option>
                  <option value="laundry">{SCHEDULE_KIND_LABELS.laundry}</option>
                </Select>
              </Field>
              <fieldset>
                <legend className="mb-1 text-sm font-medium">Days</legend>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
                  {WEEKDAYS.slice(1).map((d, i) => (
                    <label key={d} className="flex items-center gap-1.5">
                      <input type="checkbox" name="weekday" value={i + 1} /> {d.slice(0, 3)}
                    </label>
                  ))}
                </div>
              </fieldset>
              <FormGrid>
                <Field label="From">
                  <Input name="startTime" type="time" required />
                </Field>
                <Field label="To">
                  <Input name="endTime" type="time" required />
                </Field>
              </FormGrid>
              <Field label="Who it's for">
                <TargetSelect rooms={rooms} />
              </Field>
              <Field label="Name or note" hint="Tenants see this, e.g. Breakfast, Dinner, Bags at the lobby by 8 AM">
                <Input name="note" />
              </Field>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
