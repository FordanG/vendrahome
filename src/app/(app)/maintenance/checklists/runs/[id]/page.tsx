import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN, requireStaff } from "@/lib/auth";
import { canUseHotel } from "@/lib/hotel";
import { formatMoment } from "@/lib/format";
import { RESULT_LABELS } from "@/lib/checklists";
import { ActionForm } from "@/components/action-form";
import { Badge, Button, Card, Detail, Input, PageHeader, SectionTitle } from "@/components/ui";
import { cancelRun, saveRun } from "../../actions";

/** One run of a checklist in a room: mark each item, then finish. */
export default async function ChecklistRunPage({ params }: PageProps<"/maintenance/checklists/runs/[id]">) {
  const user = await requireStaff(CAN.runChecklists);
  const { id } = await params;
  const db = await getDb();
  const [row] = await db
    .select({ run: schema.checklistRuns, room: schema.rooms, checklist: schema.maintenanceChecklists, name: schema.staff.name, scannedAt: schema.roomCheckIns.at })
    .from(schema.checklistRuns)
    .innerJoin(schema.rooms, eq(schema.checklistRuns.roomId, schema.rooms.id))
    .innerJoin(schema.maintenanceChecklists, eq(schema.checklistRuns.checklistId, schema.maintenanceChecklists.id))
    .leftJoin(schema.staff, eq(schema.checklistRuns.staffId, schema.staff.id))
    .leftJoin(schema.roomCheckIns, eq(schema.checklistRuns.checkInId, schema.roomCheckIns.id))
    .where(eq(schema.checklistRuns.id, id));
  if (!row || !canUseHotel(user, row.room.propertyId)) notFound();
  const { run, room, checklist, name, scannedAt } = row;
  const finished = !!run.finishedAt;

  return (
    <>
      <PageHeader
        back={{ href: "/maintenance/checklists", label: "Checklists" }}
        title={`${checklist.name}, Room ${room.number}`}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            {finished ? <Badge tone="green">Finished</Badge> : <Badge tone="blue">In progress</Badge>}
            {scannedAt ? `Checked in at the door ${formatMoment(scannedAt)}` : <Badge tone="amber">Not checked in at the door</Badge>}
          </span>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          {finished ? (
            <ul className="divide-y divide-border text-sm">
              {run.results.map((r, i) => (
                <li key={i} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                  <span>
                    {r.label}
                    {r.note && <span className="block text-muted">{r.note}</span>}
                  </span>
                  <Badge tone={r.result === "fail" ? "red" : r.result === "ok" ? "green" : "gray"}>{r.result ? RESULT_LABELS[r.result] : "Not answered"}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <ActionForm action={saveRun.bind(null, run.id)} submitLabel="Save progress" pendingLabel="Saving…" submitVariant="secondary">
              <p className="text-sm text-muted">Each problem becomes a request for this room when you finish.</p>
              <ul className="divide-y divide-border border-y border-border">
                {run.results.map((r, i) => (
                  <li key={i} className="space-y-2 py-3">
                    <p className="text-sm font-medium">{r.label}</p>
                    <div className="grid grid-cols-3 gap-2 sm:max-w-sm" role="radiogroup" aria-label={r.label}>
                      {(Object.keys(RESULT_LABELS) as (keyof typeof RESULT_LABELS)[]).map((k) => (
                        <label key={k} className="flex min-h-11 cursor-pointer items-center justify-center gap-2 border border-border px-2 text-sm has-checked:border-brand has-checked:bg-background sm:min-h-9">
                          <input type="radio" name={`result_${i}`} value={k} defaultChecked={r.result === k} />
                          {RESULT_LABELS[k]}
                        </label>
                      ))}
                    </div>
                    <Input name={`note_${i}`} defaultValue={r.note ?? ""} placeholder="Note, needed for a problem" aria-label={`${r.label} note`} />
                  </li>
                ))}
              </ul>
              <Button type="submit" name="finish" value="1" className="w-full sm:w-auto">
                Finished checklist
              </Button>
            </ActionForm>
          )}
        </Card>
        <div className="space-y-6">
          <Card>
            <SectionTitle>Details</SectionTitle>
            <dl className="space-y-3">
              <Detail label="Started">{formatMoment(run.startedAt)}</Detail>
              <Detail label="Finished" empty="Not yet">{run.finishedAt ? formatMoment(run.finishedAt) : null}</Detail>
              <Detail label="By">{name}</Detail>
            </dl>
          </Card>
          {!finished && (
            <Card>
              <ActionForm
                action={async () => {
                  "use server";
                  return cancelRun(run.id);
                }}
                submitLabel="Cancel this checklist"
                submitVariant="danger"
                confirm="Cancel this checklist? Nothing you marked is kept."
              />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
