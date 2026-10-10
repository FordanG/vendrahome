import Link from "next/link";
import { and, asc, desc, gte, isNotNull, isNull, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN, requireStaff } from "@/lib/auth";
import { addDaysISO, formatMoment, todayISO } from "@/lib/format";
import { checklistsDue } from "@/lib/checklists";
import { everyLabel } from "@/lib/housekeeping";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Empty, Field, Input, PageHeader, SectionTitle, Textarea } from "@/components/ui";
import type { MaintenanceChecklist } from "@/db/schema";
import { saveChecklistTemplate } from "./actions";

function TemplateFields({ c }: { c?: MaintenanceChecklist }) {
  return (
    <>
      <Field label="Name" hint="e.g. Monthly room check">
        <Input name="name" defaultValue={c?.name} required />
      </Field>
      <Field label="Every this many days" hint="30 for monthly, 90 for every 3 months, 180 for twice a year">
        <Input name="everyDays" type="number" min={1} max={730} defaultValue={c?.everyDays ?? 30} required className="w-28" />
      </Field>
      <Field label="Items" hint="One per line, in the order staff go through the room">
        <Textarea name="items" rows={Math.max(5, (c?.items.length ?? 0) + 1)} defaultValue={c?.items.join("\n")} required />
      </Field>
    </>
  );
}

export default async function ChecklistsPage({ searchParams }: PageProps<"/maintenance/checklists">) {
  const user = await requireStaff(CAN.runChecklists);
  const canEdit = CAN.manageMaintenanceChecklists.includes(user.role);
  const { done } = await searchParams;
  const today = todayISO();
  const db = await getDb();
  const runQuery = () =>
    db
      .select({ run: schema.checklistRuns, number: schema.rooms.number, checklist: schema.maintenanceChecklists.name, name: schema.staff.name })
      .from(schema.checklistRuns)
      .innerJoin(schema.rooms, eq(schema.checklistRuns.roomId, schema.rooms.id))
      .innerJoin(schema.maintenanceChecklists, eq(schema.checklistRuns.checklistId, schema.maintenanceChecklists.id))
      .leftJoin(schema.staff, eq(schema.checklistRuns.staffId, schema.staff.id));
  const [due, open, recent, all] = await Promise.all([
    checklistsDue(today),
    runQuery().where(isNull(schema.checklistRuns.finishedAt)).orderBy(asc(schema.checklistRuns.startedAt)),
    runQuery()
      .where(and(isNotNull(schema.checklistRuns.finishedAt), gte(schema.checklistRuns.finishedAt, new Date(addDaysISO(today, -15) + "T16:00:00Z"))))
      .orderBy(desc(schema.checklistRuns.finishedAt))
      .limit(60),
    canEdit ? db.select().from(schema.maintenanceChecklists).orderBy(asc(schema.maintenanceChecklists.name)) : Promise.resolve([]),
  ]);
  const busy = new Set(open.map((o) => `${o.run.roomId}|${o.run.checklistId}`));

  return (
    <>
      <PageHeader
        back={{ href: "/maintenance", label: "Maintenance" }}
        title="Maintenance checklists"
        subtitle="Regular checks of every room. Scan a room's door code to run one; each problem found becomes a request."
      />
      {typeof done === "string" && (
        <p role="status" className="mb-5 text-sm text-emerald-700 dark:text-emerald-400">
          Checklist finished. {done === "0" ? "No problems found." : `${done} ${done === "1" ? "problem was" : "problems were"} added to Requests.`}
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          {open.length > 0 && (
            <section>
              <SectionTitle>Being done now</SectionTitle>
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface text-sm">
                {open.map(({ run, number, checklist, name }) => (
                  <li key={run.id}>
                    <Link href={`/maintenance/checklists/runs/${run.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 hover:bg-background/60">
                      <span className="plate w-20 font-bold">Room {number}</span>
                      <span className="flex-1">{checklist}</span>
                      <span className="text-muted">
                        {run.results.filter((r) => r.result).length} of {run.results.length}
                        {name && `, ${name}`}
                      </span>
                      {!run.checkInId && <Badge tone="amber">Not scanned</Badge>}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {due.length === 0 && <Empty>No checklists yet.{canEdit ? " Add one on the right." : " The admin adds them."}</Empty>}
          {due.map(({ checklist, rooms }) => {
            const now = rooms.filter((r) => r.due <= today && !busy.has(`${r.roomId}|${checklist.id}`));
            const floors = [...new Set(now.map((r) => r.floor))];
            return (
              <section key={checklist.id}>
                <SectionTitle>
                  {checklist.name}
                  <span className="font-normal text-muted">, {everyLabel(checklist.everyDays).toLowerCase()}</span>
                </SectionTitle>
                {now.length === 0 ? (
                  <p className="text-sm text-muted">Every room is up to date.</p>
                ) : (
                  <>
                    <p className="mb-2 text-sm text-muted">
                      {now.length} {now.length === 1 ? "room" : "rooms"} due{now.some((r) => r.daysLate > 0) && ". Red ones are overdue"}.
                    </p>
                    {floors.map((f) => (
                      <div key={f} className="mb-3">
                        <h3 className="mb-1.5 text-xs font-semibold text-muted">Floor {f}</h3>
                        <div className="flex flex-wrap gap-2">
                          {now
                            .filter((r) => r.floor === f)
                            .map((r) => (
                              <Link
                                key={r.roomId}
                                href={`/rooms/${r.roomId}`}
                                className={`plate flex h-11 w-14 items-center justify-center rounded-md border text-base font-bold ${
                                  r.daysLate > 0 ? "border-attention bg-attention text-attention-foreground" : "border-border bg-surface"
                                }`}
                              >
                                {r.number}
                              </Link>
                            ))}
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </section>
            );
          })}

          <section>
            <SectionTitle>Done in the last two weeks</SectionTitle>
            {recent.length === 0 ? (
              <Empty>None yet.</Empty>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface text-sm">
                {recent.map(({ run, number, checklist, name }) => {
                  const problems = run.results.filter((r) => r.result === "fail").length;
                  return (
                    <li key={run.id}>
                      <Link href={`/maintenance/checklists/runs/${run.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 hover:bg-background/60">
                        <span className="plate w-20 font-bold">Room {number}</span>
                        <span className="flex-1">
                          {checklist}
                          <span className="text-muted">, {formatMoment(run.finishedAt!)}{name && `, ${name}`}</span>
                        </span>
                        {problems > 0 && <Badge tone="red">{problems} {problems === 1 ? "problem" : "problems"}</Badge>}
                        {!run.checkInId && <Badge tone="amber">Not scanned</Badge>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        {canEdit && (
          <div className="space-y-6">
            {all.map((c) => (
              <Card key={c.id}>
                <details>
                  <summary className="cursor-pointer font-semibold">
                    {c.name}
                    <span className="font-normal text-muted">
                      , {c.items.length} items{!c.active && ", not in use"}
                    </span>
                  </summary>
                  <ActionForm action={saveChecklistTemplate.bind(null, c.id)} className="mt-3 space-y-4">
                    <TemplateFields c={c} />
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="active" defaultChecked={c.active} /> In use
                    </label>
                  </ActionForm>
                </details>
              </Card>
            ))}
            <Card>
              <SectionTitle>Add a checklist</SectionTitle>
              <ActionForm action={saveChecklistTemplate.bind(null, null)} submitLabel="Add checklist" resetOnSuccess>
                <TemplateFields />
              </ActionForm>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
