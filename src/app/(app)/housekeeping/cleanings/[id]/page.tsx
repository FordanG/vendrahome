import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN, requireStaff } from "@/lib/auth";
import { formatMoment } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { Badge, Button, Card, Detail, Field, PageHeader, SectionTitle, Textarea } from "@/components/ui";
import { cancelCleaning, saveCleaning } from "../../actions";

/** One cleaning: tick the steps while working, then finish. */
export default async function CleaningPage({ params }: PageProps<"/housekeeping/cleanings/[id]">) {
  await requireStaff(CAN.cleanRooms);
  const { id } = await params;
  const db = await getDb();
  const [row] = await db
    .select({ c: schema.cleanings, room: schema.rooms, name: schema.staff.name, scannedAt: schema.roomCheckIns.at })
    .from(schema.cleanings)
    .innerJoin(schema.rooms, eq(schema.cleanings.roomId, schema.rooms.id))
    .leftJoin(schema.staff, eq(schema.cleanings.staffId, schema.staff.id))
    .leftJoin(schema.roomCheckIns, eq(schema.cleanings.checkInId, schema.roomCheckIns.id))
    .where(eq(schema.cleanings.id, id));
  if (!row) notFound();
  const { c, room, name, scannedAt } = row;
  const finished = !!c.finishedAt;

  return (
    <>
      <PageHeader
        back={{ href: "/housekeeping", label: "Housekeeping" }}
        title={`Cleaning Room ${room.number}`}
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
            <>
              <SectionTitle>Checklist</SectionTitle>
              <ul className="space-y-2 text-sm">
                {c.steps.map((s, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span aria-hidden className={s.done ? "text-emerald-700 dark:text-emerald-400" : "text-attention"}>{s.done ? "✓" : "✗"}</span>
                    <span>
                      {s.label}
                      {!s.done && <span className="text-attention"> (not done)</span>}
                    </span>
                  </li>
                ))}
              </ul>
              {c.notes && <p className="mt-4 whitespace-pre-wrap text-sm">{c.notes}</p>}
            </>
          ) : (
            <ActionForm action={saveCleaning.bind(null, c.id)} submitLabel="Save progress" pendingLabel="Saving…" submitVariant="secondary">
              <fieldset className="space-y-1">
                <legend className="mb-2 text-[15px] font-semibold">Checklist</legend>
                {c.steps.length === 0 && <p className="text-sm text-muted">There&apos;s no checklist yet. Add notes below if needed.</p>}
                {c.steps.map((s, i) => (
                  <label key={i} className="flex min-h-11 cursor-pointer items-center gap-3 border-b border-border text-sm last:border-0">
                    <input type="checkbox" name={`step_${i}`} defaultChecked={s.done} className="size-5" />
                    {s.label}
                  </label>
                ))}
              </fieldset>
              <Field label="Notes" hint="Anything the next person should know">
                <Textarea name="notes" rows={2} defaultValue={c.notes ?? ""} maxLength={2000} />
              </Field>
              <Button type="submit" name="finish" value="1" className="w-full sm:w-auto">
                Finished cleaning
              </Button>
            </ActionForm>
          )}
        </Card>
        <div className="space-y-6">
          <Card>
            <dl className="space-y-3">
              <Detail label="Started">{formatMoment(c.startedAt)}</Detail>
              <Detail label="Finished" empty="Not yet">{c.finishedAt ? formatMoment(c.finishedAt) : null}</Detail>
              <Detail label="By">{name}</Detail>
            </dl>
            <p className="mt-4 text-sm">
              Something broken or missing?{" "}
              <Link className="underline" href={`/inventory/rooms/${room.id}`}>Open the room&apos;s items</Link>
            </p>
          </Card>
          {!finished && (
            <Card>
              <ActionForm
                action={async () => {
                  "use server";
                  return cancelCleaning(c.id);
                }}
                submitLabel="Cancel this cleaning"
                submitVariant="danger"
                confirm="Cancel this cleaning? It won't count as cleaned."
              />
              <p className="mt-2 text-xs text-muted">Use this if it was started by mistake.</p>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
