import { and, asc, desc, eq, gte, ne } from "drizzle-orm";
import { visitPermission } from "@/lib/service-work";
import { getDb, schema } from "@/db";
import { CAN, requireStaff } from "@/lib/auth";
import { addDaysISO, formatDate, formatTimeRange, todayISO } from "@/lib/format";
import { VISIT_STATUS_LABELS, VISIT_STATUS_TONES } from "@/lib/portal";
import { ActionForm } from "@/components/action-form";
import { TargetSelect } from "@/components/target-select";
import { Badge, Card, Empty, Field, FormGrid, Input, PageHeader, SectionTitle, Select, ViewTabs } from "@/components/ui";
import type { MaintenanceVisit } from "@/db/schema";
import { scheduleVisits, updateVisit, updateVisitBatch } from "./actions";

type Row = { v: MaintenanceVisit; roomNumber: string; floor: number };

const weekday = new Intl.DateTimeFormat("en-PH", { weekday: "long", timeZone: "UTC" });

function dayHeading(date: string, today: string) {
  if (date === today) return "Today";
  if (date === addDaysISO(today, 1)) return "Tomorrow";
  if (date === addDaysISO(today, -1)) return "Yesterday";
  return weekday.format(new Date(date + "T00:00:00Z"));
}

/** "Floor 2", "Every room", "Floors 2 and 3" or a list of room numbers. */
function roomsLabel(rows: Row[], roomsPerFloor: Map<number, number>, totalRooms: number) {
  if (rows.length === totalRooms) return "Every room";
  const floors = [...new Set(rows.map((r) => r.floor))].sort((a, b) => a - b);
  const whole = floors.every((f) => rows.filter((r) => r.floor === f).length === roomsPerFloor.get(f));
  if (whole) return floors.length === 1 ? `Floor ${floors[0]}` : `Floors ${floors.slice(0, -1).join(", ")} and ${floors.at(-1)}`;
  const numbers = rows.map((r) => r.roomNumber);
  return numbers.length <= 4 ? `Rooms ${numbers.join(", ")}` : `Rooms ${numbers.slice(0, 3).join(", ")} and ${numbers.length - 3} more`;
}

function VisitForm({ v, staff, canAssign }: { v: MaintenanceVisit; staff: { id: string; name: string }[]; canAssign: boolean }) {
  return (
    <ActionForm action={updateVisit.bind(null, v.id)}>
      <FormGrid>
        {canAssign ? <Field label="Assigned to"><Select name="assigneeId" defaultValue={v.assigneeId ?? ""}><option value="">Unassigned</option>{staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
          : <p className="text-sm text-muted sm:col-span-2">{v.assigneeId ? "Assigned to you." : "Saving this visit assigns it to you."}</p>}
        <Field label="Status">
          <Select name="status" defaultValue={v.status}>
            {Object.entries(VISIT_STATUS_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Date">
          <Input name="date" type="date" defaultValue={v.date} required />
        </Field>
        <Field label="From">
          <Input name="timeFrom" type="time" defaultValue={v.timeFrom ?? ""} />
        </Field>
        <Field label="To">
          <Input name="timeTo" type="time" defaultValue={v.timeTo ?? ""} />
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <Input name="notes" defaultValue={v.notes ?? ""} />
        </Field>
      </FormGrid>
    </ActionForm>
  );
}

function VisitSummary({ v, rooms, count }: { v: MaintenanceVisit; rooms: string; count?: number }) {
  const time = formatTimeRange(v.timeFrom, v.timeTo);
  return (
    // Phones: what and where on top, then when, then the status; one line each.
    <summary className="block cursor-pointer select-none px-4 py-3 text-sm hover:bg-background/60 sm:flex sm:flex-wrap sm:items-center sm:gap-x-3 sm:gap-y-1">
      <span className="flex items-baseline justify-between gap-3 sm:contents">
        <span className="text-base font-semibold sm:order-2 sm:text-sm sm:font-medium">{v.title}</span>
        <span className="plate shrink-0 text-base font-bold sm:order-1 sm:w-36">{rooms}</span>
      </span>
      <span className="mt-0.5 flex flex-wrap gap-x-3 text-muted sm:order-3 sm:mt-0 sm:contents">
        {time && <span className="sm:order-4">{time}</span>}
        {count && count > 1 && <span className="sm:order-3">{count} rooms, open to see each</span>}
      </span>
      <span className="mt-2 flex gap-2 sm:order-5 sm:ml-auto sm:mt-0">
        {v.requestId && <Badge>Asked by tenant</Badge>}
        <Badge tone={VISIT_STATUS_TONES[v.status]}>{VISIT_STATUS_LABELS[v.status]}</Badge>
      </span>
    </summary>
  );
}

export default async function MaintenancePage({ searchParams }: PageProps<"/maintenance">) {
  const user = await requireStaff();
  const canManage = CAN.manageVisits.includes(user.role);
  const view = (await searchParams).view === "past" ? "past" : "upcoming";
  const today = todayISO();
  const db = await getDb();

  const staff = await db.query.staff.findMany({ where: and(eq(schema.staff.active, true), ne(schema.staff.role, "tenant")), orderBy: [asc(schema.staff.name)] });
  const visitQuery = db
    .select({ v: schema.maintenanceVisits, roomNumber: schema.rooms.number, floor: schema.rooms.floor })
    .from(schema.maintenanceVisits)
    .innerJoin(schema.rooms, eq(schema.maintenanceVisits.roomId, schema.rooms.id));
  const [allVisits, rooms] = await Promise.all([
    view === "upcoming"
      ? // Everything still open, including overdue visits nobody closed.
        visitQuery
          .where(eq(schema.maintenanceVisits.status, "scheduled"))
          .orderBy(asc(schema.maintenanceVisits.date), asc(schema.maintenanceVisits.timeFrom), asc(schema.rooms.number))
      : visitQuery
          .where(
            and(
              ne(schema.maintenanceVisits.status, "scheduled"),
              gte(schema.maintenanceVisits.date, addDaysISO(today, -90)),
            ),
          )
          .orderBy(desc(schema.maintenanceVisits.date), asc(schema.rooms.number)),
    db
      .select({ id: schema.rooms.id, number: schema.rooms.number, floor: schema.rooms.floor })
      .from(schema.rooms)
      .orderBy(asc(schema.rooms.floor), asc(schema.rooms.number)),
  ]);
  const permissions = await Promise.all(allVisits.map(({v}) => visitPermission(user, v)));
  const visits = allVisits.filter((_, i) => !permissions[i]);
  const roomsPerFloor = new Map<number, number>();
  for (const r of rooms) roomsPerFloor.set(r.floor, (roomsPerFloor.get(r.floor) ?? 0) + 1);

  // Visits booked together (same job, day, time and status) show as one row.
  const groups = new Map<string, Row[]>();
  for (const row of visits) {
    const v = row.v;
    const key = v.requestId ? v.id : [v.date, v.title, v.timeFrom, v.timeTo, v.status, v.assigneeId].join("|");
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const dates = [...new Set(visits.map((x) => x.v.date))];
  const overdue = view === "upcoming" ? visits.filter((x) => x.v.date < today).length : 0;

  return (
    <>
      <PageHeader
        title="Maintenance visits"
        subtitle={
          view === "upcoming"
            ? `${visits.length} scheduled${overdue ? `, ${overdue} overdue` : ""}. Tenants see the visits for their room.`
            : "Done, missed and cancelled visits from the last 90 days."
        }
        actions={
          <ViewTabs
            items={[
              { href: "/maintenance", label: "Scheduled", count: view === "upcoming" ? visits.length : undefined, active: view === "upcoming" },
              { href: "/maintenance?view=past", label: "Past", active: view === "past" },
            ]}
          />
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {visits.length === 0 && (
            <Empty>{view === "upcoming" ? "No visits scheduled. Use Schedule a visit to book one." : "No past visits."}</Empty>
          )}
          {dates.map((d) => (
            <section key={d}>
              <h2 className="mb-2 flex items-baseline gap-2">
                <span className={`font-semibold ${view === "upcoming" && d < today ? "text-attention" : ""}`}>{dayHeading(d, today)}</span>
                <span className="text-sm text-muted">{formatDate(d)}</span>
                {view === "upcoming" && d < today && <Badge tone="red">Overdue</Badge>}
              </h2>
              <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
                {[...groups.values()]
                  .filter((g) => g[0].v.date === d)
                  .map((g) => {
                    const first = g[0].v;
                    if (g.length === 1) {
                      return (
                        <details key={first.id}>
                          <VisitSummary v={first} rooms={`Room ${g[0].roomNumber}`} />
                          <div className="border-t border-border bg-background/40 px-4 py-3">
                            {first.notes && <p className="mb-3 whitespace-pre-wrap text-sm text-muted">{first.notes}</p>}
                            {canManage ? <VisitForm v={first} staff={staff} canAssign={user.role !== "maintenance"} /> : !first.notes && <p className="text-sm text-muted">No notes.</p>}
                          </div>
                        </details>
                      );
                    }
                    return (
                      <details key={first.id}>
                        <VisitSummary v={first} rooms={roomsLabel(g, roomsPerFloor, rooms.length)} count={g.length} />
                        <div className="space-y-4 border-t border-border bg-background/40 px-4 py-3">
                          {first.notes && <p className="whitespace-pre-wrap text-sm text-muted">{first.notes}</p>}
                          {canManage && (
                            <ActionForm
                              action={updateVisitBatch.bind(null, g.map((x) => x.v.id))}
                              submitLabel={`Update all ${g.length}`}
                              className="flex flex-wrap items-end gap-3"
                            >
                              <Field label="Set all to">
                                <Select name="status" defaultValue={first.status === "scheduled" ? "done" : first.status}>
                                  {Object.entries(VISIT_STATUS_LABELS).map(([k, label]) => (
                                    <option key={k} value={k}>
                                      {label}
                                    </option>
                                  ))}
                                </Select>
                              </Field>
                              <Field label="Move all to a new date" hint="Optional">
                                <Input name="date" type="date" />
                              </Field>
                            </ActionForm>
                          )}
                          <div>
                            <p className="mb-1.5 text-xs text-muted">Or change one room:</p>
                            <div className="divide-y divide-border rounded-lg border border-border bg-surface">
                              {g.map(({ v, roomNumber }) => (
                                <details key={v.id}>
                                  <summary className="flex cursor-pointer select-none items-center justify-between px-3 py-2 text-sm hover:bg-background/60">
                                    <span className="plate font-bold">Room {roomNumber}</span>
                                    <Badge tone={VISIT_STATUS_TONES[v.status]}>{VISIT_STATUS_LABELS[v.status]}</Badge>
                                  </summary>
                                  {canManage && (
                                    <div className="border-t border-border px-3 py-3">
                                      <VisitForm v={v} staff={staff} canAssign={user.role !== "maintenance"} />
                                    </div>
                                  )}
                                </details>
                              ))}
                            </div>
                          </div>
                        </div>
                      </details>
                    );
                  })}
              </div>
            </section>
          ))}
        </div>

        {canManage && (
          <Card className="self-start lg:sticky lg:top-8">
            <SectionTitle>Schedule a visit</SectionTitle>
            <ActionForm action={scheduleVisits} submitLabel="Schedule" resetOnSuccess>
              {user.role !== "maintenance" && <Field label="Assigned to"><Select name="assigneeId"><option value="">Unassigned</option>{staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>}
              <Field label="What for" hint="e.g. Aircon cleaning, Monthly room check, Pest control">
                <Input name="title" required />
              </Field>
              <Field label="Rooms" hint="A floor or every room books one visit per room.">
                <TargetSelect rooms={rooms} allLabel="Every room" />
              </Field>
              <Field label="Date">
                <Input name="date" type="date" defaultValue={today} required />
              </Field>
              <FormGrid>
                <Field label="From">
                  <Input name="timeFrom" type="time" />
                </Field>
                <Field label="To">
                  <Input name="timeTo" type="time" />
                </Field>
              </FormGrid>
              <Field label="Notes">
                <Input name="notes" />
              </Field>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
