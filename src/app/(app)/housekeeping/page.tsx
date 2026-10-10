import Link from "next/link";
import { and, asc, desc, eq, gte, isNotNull, isNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN, requireStaff } from "@/lib/auth";
import { addDaysISO, formatDate, formatMoment, todayISO } from "@/lib/format";
import { cleaningsDue, everyLabel, lastCleanedLabel, type CleaningDue } from "@/lib/housekeeping";
import { ActionForm } from "@/components/action-form";
import { RoomPlate } from "@/components/list";
import { Badge, Card, Empty, Field, Input, PageHeader, SectionTitle, Select, Textarea } from "@/components/ui";
import { saveChecklist, setCleaningSchedule } from "./actions";

function DuePlate({ r, today }: { r: CleaningDue; today: string }) {
  const late = r.daysLate > 0;
  return (
    <Link
      href={`/rooms/${r.id}`}
      title={`${late ? `${r.daysLate} ${r.daysLate === 1 ? "day" : "days"} overdue` : "Due today"}. ${lastCleanedLabel(r.lastCleaned, today)}.`}
      className={`plate flex h-12 w-16 flex-col items-center justify-center rounded-md border text-lg font-bold leading-none ${
        late ? "border-attention bg-attention text-attention-foreground" : "border-border bg-surface"
      }`}
    >
      {r.number}
      {late && <span className="mt-0.5 text-[10px] font-medium">{r.daysLate}d late</span>}
    </Link>
  );
}

export default async function HousekeepingPage() {
  const user = await requireStaff(CAN.cleanRooms);
  const today = todayISO();
  const db = await getDb();
  const [due, inProgress, recent, steps, rooms, roomTypes] = await Promise.all([
    cleaningsDue(today),
    db
      .select({ c: schema.cleanings, number: schema.rooms.number, name: schema.staff.name })
      .from(schema.cleanings)
      .innerJoin(schema.rooms, eq(schema.cleanings.roomId, schema.rooms.id))
      .leftJoin(schema.staff, eq(schema.cleanings.staffId, schema.staff.id))
      .where(isNull(schema.cleanings.finishedAt))
      .orderBy(asc(schema.cleanings.startedAt)),
    db
      .select({ c: schema.cleanings, number: schema.rooms.number, name: schema.staff.name })
      .from(schema.cleanings)
      .innerJoin(schema.rooms, eq(schema.cleanings.roomId, schema.rooms.id))
      .leftJoin(schema.staff, eq(schema.cleanings.staffId, schema.staff.id))
      .where(and(isNotNull(schema.cleanings.finishedAt), gte(schema.cleanings.finishedAt, new Date(addDaysISO(today, -8) + "T16:00:00Z"))))
      .orderBy(desc(schema.cleanings.finishedAt))
      .limit(100),
    db.select().from(schema.cleaningSteps).orderBy(asc(schema.cleaningSteps.position), asc(schema.cleaningSteps.label)),
    db.select({ id: schema.rooms.id, number: schema.rooms.number, floor: schema.rooms.floor, roomTypeId: schema.rooms.roomTypeId, cleanEveryDays: schema.rooms.cleanEveryDays }).from(schema.rooms).orderBy(asc(schema.rooms.floor), asc(schema.rooms.number)),
    db.select().from(schema.roomTypes).orderBy(asc(schema.roomTypes.name)),
  ]);
  const busy = new Set(inProgress.map((x) => x.c.roomId));
  const now = due.filter((r) => r.due <= today && !busy.has(r.id));
  const overdue = now.filter((r) => r.daysLate > 0).length;
  const soon = due.filter((r) => r.due > today && r.due <= addDaysISO(today, 3) && !busy.has(r.id));
  const floors = [...new Set(rooms.map((r) => r.floor))];
  const unscheduled = rooms.filter((r) => r.cleanEveryDays == null).length;
  const byInterval = new Map<number, number>();
  for (const r of rooms) if (r.cleanEveryDays != null) byInterval.set(r.cleanEveryDays, (byInterval.get(r.cleanEveryDays) ?? 0) + 1);

  return (
    <>
      <PageHeader
        title="Housekeeping"
        subtitle={
          due.length === 0
            ? "No rooms are on a cleaning schedule yet. Set one below."
            : `${now.length} ${now.length === 1 ? "room" : "rooms"} to clean today${overdue ? `, ${overdue} overdue` : ""}. Scan the door code and tap Clean this room to start.`
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          {inProgress.length > 0 && (
            <section>
              <SectionTitle>Being cleaned now</SectionTitle>
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
                {inProgress.map(({ c, number, name }) => (
                  <li key={c.id}>
                    <Link href={`/housekeeping/cleanings/${c.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-background/60">
                      <RoomPlate number={number} />
                      <span className="min-w-0 flex-1 text-sm">
                        <span className="block font-medium">Started {formatMoment(c.startedAt)}{name && ` by ${name}`}</span>
                        <span className="text-muted">
                          {c.steps.filter((s) => s.done).length} of {c.steps.length} steps done
                        </span>
                      </span>
                      {!c.checkInId && <Badge tone="amber">Not scanned</Badge>}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <SectionTitle>To clean today</SectionTitle>
            {now.length === 0 ? (
              <Empty>{due.length === 0 ? "No rooms are on a cleaning schedule." : "Nothing due today."}</Empty>
            ) : (
              <>
                {floors
                  .filter((f) => now.some((r) => r.floor === f))
                  .map((f) => (
                    <div key={f} className="mb-4">
                      <h3 className="mb-1.5 text-sm font-semibold text-muted">Floor {f}</h3>
                      <div className="flex flex-wrap gap-2">
                        {now.filter((r) => r.floor === f).map((r) => <DuePlate key={r.id} r={r} today={today} />)}
                      </div>
                    </div>
                  ))}
                <p className="text-xs text-muted">Red rooms are overdue. Scan a room&apos;s door code to start cleaning it, or tap the room here.</p>
              </>
            )}
          </section>

          {soon.length > 0 && (
            <section>
              <SectionTitle>Coming up in the next 3 days</SectionTitle>
              <p className="text-sm text-muted">
                {soon.map((r) => `Room ${r.number} (${formatDate(r.due)})`).join(", ")}
              </p>
            </section>
          )}

          <section>
            <SectionTitle>Cleaned in the last week</SectionTitle>
            {recent.length === 0 ? (
              <Empty>No cleanings recorded in the last week.</Empty>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface text-sm">
                {recent.map(({ c, number, name }) => {
                  const skipped = c.steps.filter((s) => !s.done).length;
                  return (
                    <li key={c.id}>
                      <Link href={`/housekeeping/cleanings/${c.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 hover:bg-background/60">
                        <span className="plate w-20 font-bold">Room {number}</span>
                        <span className="flex-1 text-muted">
                          {formatMoment(c.finishedAt!)}
                          {name && `, ${name}`}
                        </span>
                        {skipped > 0 && <Badge tone="amber">{skipped} {skipped === 1 ? "step" : "steps"} not done</Badge>}
                        {!c.checkInId && <Badge tone="red">No door-code check-in</Badge>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <div className="space-y-6">
          {CAN.manageCleaningSchedule.includes(user.role) && (
            <Card>
              <SectionTitle>How often rooms are cleaned</SectionTitle>
              <ul className="mb-4 space-y-1 text-sm text-muted">
                {[...byInterval.entries()].sort((a, b) => a[0] - b[0]).map(([days, n]) => (
                  <li key={days}>
                    {everyLabel(days)}: {n} {n === 1 ? "room" : "rooms"}
                  </li>
                ))}
                {unscheduled > 0 && <li>Not on a schedule: {unscheduled} {unscheduled === 1 ? "room" : "rooms"}</li>}
              </ul>
              <ActionForm action={setCleaningSchedule} submitLabel="Set schedule">
                <Field label="Which rooms">
                  <Select name="which" defaultValue="all">
                    <option value="all">Every room ({rooms.length})</option>
                    {roomTypes.length > 0 && (
                      <optgroup label="A room type">
                        {roomTypes.map((t) => (
                          <option key={t.id} value={`type:${t.id}`}>
                            Every {t.name} room ({rooms.filter((r) => r.roomTypeId === t.id).length})
                          </option>
                        ))}
                      </optgroup>
                    )}
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
                          Room {r.number}
                        </option>
                      ))}
                    </optgroup>
                  </Select>
                </Field>
                <Field label="Clean every this many days" hint="7 for once a week. Leave blank to take the rooms off the schedule.">
                  <Input name="every" type="number" min={1} max={90} className="w-28" />
                </Field>
              </ActionForm>
            </Card>
          )}

          <Card>
            <SectionTitle>Cleaning checklist</SectionTitle>
            {CAN.manageChecklist.includes(user.role) ? (
              <ActionForm action={saveChecklist} submitLabel="Save checklist">
                <Field label="Steps" hint="One step per line, in order. Cleanings already started keep the list they began with.">
                  <Textarea name="steps" rows={Math.max(6, steps.length + 1)} defaultValue={steps.map((s) => s.label).join("\n")} />
                </Field>
              </ActionForm>
            ) : steps.length === 0 ? (
              <p className="text-sm text-muted">No checklist yet. The admin sets it.</p>
            ) : (
              <ol className="list-decimal space-y-1 pl-5 text-sm">
                {steps.map((s) => <li key={s.id}>{s.label}</li>)}
              </ol>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
