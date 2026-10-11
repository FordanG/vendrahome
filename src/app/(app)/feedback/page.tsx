import { and, desc, eq, isNull, lte } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb, schema } from "@/db";
import { CAN } from "@/lib/auth";
import { inHotelRooms, requireHotel } from "@/lib/hotel";
import { formatMoment } from "@/lib/format";
import { FLAG_AT, feedbackSummary, TOPIC_LABELS } from "@/lib/feedback";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Empty, Field, Input, PageHeader, SectionTitle } from "@/components/ui";
import { followUp } from "./actions";

const followedBy = alias(schema.staff, "followed_by");
const Stars = ({ n }: { n: number }) => (
  <span aria-label={`${n} of 5 stars`} className={n <= FLAG_AT ? "text-attention" : "text-brand"}>
    {"★".repeat(n)}
    <span className="text-muted/40">{"★".repeat(5 - n)}</span>
  </span>
);

export default async function FeedbackPage() {
  const { hotel } = await requireHotel(CAN.viewFeedback);
  const db = await getDb();
  const query = () =>
    db
      .select({ f: schema.feedback, name: schema.occupants.fullName, room: schema.rooms.number, by: followedBy.name })
      .from(schema.feedback)
      .innerJoin(schema.occupants, eq(schema.feedback.occupantId, schema.occupants.id))
      .leftJoin(schema.rooms, eq(schema.feedback.roomId, schema.rooms.id))
      .leftJoin(followedBy, eq(schema.feedback.followedUpBy, followedBy.id));
  const [flagged, recent, summary] = await Promise.all([
    query().where(and(inHotelRooms(schema.feedback.roomId, hotel.id), lte(schema.feedback.stars, FLAG_AT), isNull(schema.feedback.followUp))).orderBy(desc(schema.feedback.createdAt)),
    query().where(inHotelRooms(schema.feedback.roomId, hotel.id)).orderBy(desc(schema.feedback.createdAt)).limit(60),
    feedbackSummary(30, hotel.id),
  ]);

  return (
    <>
      <PageHeader title="Feedback" subtitle={`Tenants rate cleanings, repairs and laundry. Ratings of ${FLAG_AT} stars or fewer stay here until someone follows up.`} />
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        {summary.map((s) => (
          <Card key={s.topic} className="p-4">
            <p className="text-xs text-muted">{TOPIC_LABELS[s.topic]}, last 30 days</p>
            <p className="plate mt-1 text-2xl font-bold">{s.average == null ? "No ratings" : `${s.average.toFixed(1)} ★`}</p>
            <p className="text-xs text-muted">{s.count} {s.count === 1 ? "rating" : "ratings"}</p>
          </Card>
        ))}
      </div>

      <section className="mb-8">
        <SectionTitle>Needs a follow-up</SectionTitle>
        {flagged.length === 0 ? (
          <Empty>Nothing to follow up.</Empty>
        ) : (
          <div className="space-y-3">
            {flagged.map(({ f, name, room }) => (
              <Card key={f.id} className="border-attention/50">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <Stars n={f.stars} />
                  <span className="font-medium">{TOPIC_LABELS[f.topic]}</span>
                  <span className="text-muted">
                    {name}, room {room ?? "?"}, {formatMoment(f.createdAt)}
                  </span>
                </div>
                {f.comment && <p className="mt-2 whitespace-pre-wrap text-sm">{f.comment}</p>}
                <ActionForm action={followUp.bind(null, f.id)} submitLabel="Save follow-up" className="mt-3 flex flex-wrap items-end gap-3">
                  <Field label="What was done" className="min-w-0 flex-1">
                    <Input name="followUp" required placeholder="e.g. Talked to the tenant, re-cleaned the bathroom" />
                  </Field>
                </ActionForm>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionTitle>Latest ratings</SectionTitle>
        {recent.length === 0 ? (
          <Empty>No ratings yet.</Empty>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface text-sm">
            {recent.map(({ f, name, room, by }) => (
              <li key={f.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Stars n={f.stars} />
                  <span className="font-medium">{TOPIC_LABELS[f.topic]}</span>
                  <span className="text-muted">
                    {name}, room {room ?? "?"}, {formatMoment(f.createdAt)}
                  </span>
                  {f.stars <= FLAG_AT && !f.followUp && <Badge tone="red">Needs a follow-up</Badge>}
                </div>
                {f.comment && <p className="mt-1 whitespace-pre-wrap">{f.comment}</p>}
                {f.followUp && (
                  <p className="mt-1 text-muted">
                    Follow-up: {f.followUp}
                    {by && ` (${by})`}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
