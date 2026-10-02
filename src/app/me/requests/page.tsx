import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireTenant } from "@/lib/auth";
import { formatDate, formatTimeRange, todayISO } from "@/lib/format";
import {
  appliesToRoom,
  getCurrentStay,
  getSchedule,
  REQUEST_KIND_LABELS,
  REQUEST_STATUS_TONES,
  daysLabel,
  groupByDays,
  requestStatusLabel,
} from "@/lib/portal";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Empty, Field, FormGrid, Input, PageHeader, SectionTitle, Select, Textarea } from "@/components/ui";
import { cancelRequest, createRequest } from "../actions";

const at = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" });

export default async function TenantRequestsPage({ searchParams }: PageProps<"/me/requests">) {
  const { occupant } = await requireTenant();
  const kind = (await searchParams).kind;
  const db = await getDb();
  const [stay, schedule, requests] = await Promise.all([
    getCurrentStay(occupant.id),
    getSchedule(),
    db
      .select()
      .from(schema.tenantRequests)
      .where(eq(schema.tenantRequests.occupantId, occupant.id))
      .orderBy(desc(schema.tenantRequests.createdAt))
      .limit(50),
  ]);
  const laundry = stay ? schedule.map((s) => s.e).filter((e) => e.kind === "laundry" && appliesToRoom(e, stay.room)) : [];

  return (
    <>
      <PageHeader title="Requests" subtitle={stay ? `For room ${stay.room.number}` : undefined} />
      <div className="space-y-6">
        {stay ? (
          <Card>
            <SectionTitle>Send a new request</SectionTitle>
            <ActionForm action={createRequest} submitLabel="Send" pendingLabel="Sending…" resetOnSuccess>
              <Field label="What do you need?">
                <Select name="kind" defaultValue={kind === "laundry" || kind === "maintenance" ? kind : "issue"}>
                  <option value="issue">Report a problem in my room</option>
                  <option value="maintenance">Ask for a maintenance visit</option>
                  <option value="laundry">Laundry pickup on a different day</option>
                </Select>
              </Field>
              <Field label="Tell us more" hint="What happened, where in the room, and anything we should know">
                <Textarea name="details" rows={4} required maxLength={2000} />
              </Field>
              <FormGrid>
                <Field label="Preferred date" hint="Needed for maintenance visits and laundry pickups">
                  <Input name="preferredDate" type="date" min={todayISO()} />
                </Field>
                <Field label="Preferred time" hint="e.g. After 6 PM, Morning">
                  <Input name="preferredTime" />
                </Field>
              </FormGrid>
              <label className="flex min-h-11 items-center gap-2.5 text-sm sm:min-h-0">
                <input type="checkbox" name="urgent" /> Urgent (leak, no power, safety problem)
              </label>
              <p className="text-xs text-muted">
                Maintenance and laundry requests need approval. You&apos;ll see the answer below.
                {laundry.length > 0 &&
                  ` Regular laundry pickup: ${groupByDays(laundry)
                    .map((g) => `${daysLabel(g.days)} ${formatTimeRange(g.first.startTime, g.first.endTime)}`)
                    .join("; ")}.`}
              </p>
            </ActionForm>
          </Card>
        ) : (
          <Empty>You don&apos;t have a room right now, so you can&apos;t send requests. Please talk to the front desk.</Empty>
        )}

        <section>
          <SectionTitle>Your requests</SectionTitle>
          {requests.length === 0 ? (
            <p className="text-sm text-muted">You haven&apos;t sent any requests yet.</p>
          ) : (
            <div className="space-y-3">
              {requests.map((r) => (
                <Card key={r.id} className="p-3 sm:p-4">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">{REQUEST_KIND_LABELS[r.kind]}</span>
                    <Badge tone={REQUEST_STATUS_TONES[r.status]}>{requestStatusLabel(r)}</Badge>
                    {r.urgent && <Badge tone="red">Urgent</Badge>}
                    <span className="text-xs text-muted">{at.format(r.createdAt)}</span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm">{r.details}</p>
                  {(r.preferredDate || r.preferredTime) && (
                    <p className="mt-1 text-xs text-muted">
                      You asked for {[r.preferredDate && formatDate(r.preferredDate), r.preferredTime].filter(Boolean).join(", ")}
                    </p>
                  )}
                  {r.scheduledDate && r.status !== "declined" && (
                    <p className="mt-2 text-sm font-medium">
                      Booked for {[formatDate(r.scheduledDate), formatTimeRange(r.scheduledFrom, r.scheduledTo)].filter(Boolean).join(", ")}
                    </p>
                  )}
                  {r.response && <p className="mt-1 text-sm">Front desk: {r.response}</p>}
                  {r.status === "pending" && (
                    <div className="mt-3">
                      <ActionForm
                        action={cancelRequest.bind(null, r.id)}
                        submitLabel="Cancel request"
                        pendingLabel="Cancelling…"
                        submitVariant="secondary"
                        confirm="Cancel this request?"
                      />
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
