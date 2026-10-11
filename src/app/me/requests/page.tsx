import Link from "next/link";
import { and, count, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireTenant } from "@/lib/auth";
import { formatDate, formatTimeRange, todayISO } from "@/lib/format";
import {
  getCurrentStay,
  REQUEST_KIND_LABELS,
  REQUEST_STATUS_TONES,
  requestStatusLabel,
  tenantHotelId,
} from "@/lib/portal";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Empty, Field, FormGrid, Input, PageHeader, SectionTitle, Select, Textarea } from "@/components/ui";
import { cancelRequest, createRequest } from "../actions";

const at = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" });

export default async function TenantRequestsPage({ searchParams }: PageProps<"/me/requests">) {
  const { occupant } = await requireTenant();
  const params = await searchParams;
  const kind = params.kind;
  const db = await getDb();
  const scope = eq(schema.tenantRequests.occupantId, occupant.id);
  const [{ total }] = await db.select({ total: count() }).from(schema.tenantRequests).where(scope);
  const pageSize = 50;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.max(1, Math.min(totalPages, Math.floor(Number(params.page) || 1)));
  const [stay, requests] = await Promise.all([
    getCurrentStay(occupant.id),
    db
      .select()
      .from(schema.tenantRequests)
      .where(scope)
      .orderBy(desc(schema.tenantRequests.createdAt), desc(schema.tenantRequests.id))
      .limit(pageSize).offset((page - 1) * pageSize),
  ]);
  // Came from a shared space's door code: the form reports a problem there.
  const area = typeof params.area === "string" && /^[0-9a-f-]{36}$/.test(params.area)
    ? await db.query.areas.findFirst({
        where: and(eq(schema.areas.id, params.area), eq(schema.areas.active, true), eq(schema.areas.propertyId, (await tenantHotelId(occupant)) ?? "")),
      })
    : undefined;
  const areaIds = [...new Set(requests.map((r) => r.areaId).filter((x): x is string => !!x))];
  const areaNames = new Map(
    areaIds.length ? (await db.query.areas.findMany({ columns: { id: true, name: true } })).map((a) => [a.id, a.name]) : [],
  );

  return (
    <>
      <PageHeader title="Requests" subtitle={stay ? `For room ${stay.room.number}` : undefined} />
      <div className="space-y-6">
        {stay ? (
          area ? (
          <Card className="border-brand">
            <SectionTitle actions={<Link className="text-sm text-muted underline" href="/me/requests">Something else?</Link>}>
              Report a problem: {area.name}
            </SectionTitle>
            <ActionForm action={createRequest} submitLabel="Send" pendingLabel="Sending…" resetOnSuccess>
              <input type="hidden" name="areaId" value={area.id} />
              <input type="hidden" name="kind" value="issue" />
              <Field label="What's wrong?" hint="What you saw and where exactly">
                <Textarea name="details" rows={4} required maxLength={2000} />
              </Field>
              <Field label="Photo" hint="Optional, helps us see the problem">
                <Input name="photo" type="file" accept="image/*" />
              </Field>
              <label className="flex min-h-11 items-center gap-2.5 text-sm sm:min-h-0">
                <input type="checkbox" name="urgent" /> Urgent (leak, no power, safety problem)
              </label>
            </ActionForm>
          </Card>
          ) : (
          <Card>
            <SectionTitle>Send a new request</SectionTitle>
            <ActionForm action={createRequest} submitLabel="Send" pendingLabel="Sending…" resetOnSuccess>
              <Field label="What do you need?">
                <Select name="kind" defaultValue={kind === "maintenance" ? kind : "issue"}>
                  <option value="issue">Report a problem in my room</option>
                  <option value="maintenance">Ask for a maintenance visit</option>
                </Select>
              </Field>
              <Field label="Tell us more" hint="What happened, where in the room, and anything we should know">
                <Textarea name="details" rows={4} required maxLength={2000} />
              </Field>
              <FormGrid>
                <Field label="Preferred date" hint="Needed for maintenance visits">
                  <Input name="preferredDate" type="date" min={todayISO()} />
                </Field>
                <Field label="Preferred time" hint="e.g. After 6 PM, Morning">
                  <Input name="preferredTime" />
                </Field>
              </FormGrid>
              <Field label="Photo" hint="Optional, helps us see the problem">
                <Input name="photo" type="file" accept="image/*" />
              </Field>
              <label className="flex min-h-11 items-center gap-2.5 text-sm sm:min-h-0">
                <input type="checkbox" name="urgent" /> Urgent (leak, no power, safety problem)
              </label>
              <p className="text-xs text-muted">
                Maintenance visits need approval. You&apos;ll see the answer below. For laundry, bring your bag to the front desk.
              </p>
            </ActionForm>
          </Card>
          )
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
                    {r.areaId && <span className="text-muted">in {areaNames.get(r.areaId) ?? "a shared space"}</span>}
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
                      {r.status === "done" ? "Appointment date" : "Booked for"} {[formatDate(r.scheduledDate), formatTimeRange(r.scheduledFrom, r.scheduledTo)].filter(Boolean).join(", ")}
                    </p>
                  )}
                  {r.response && <p className="mt-1 text-sm">{r.cancelledAt ? r.response : `Staff reply: ${r.response}`}</p>}
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
          {totalPages > 1 && <nav className="mt-4 flex items-center gap-5 text-sm" aria-label="Your request pages">
            {page > 1 && <Link className="underline" href={`/me/requests?page=${page - 1}`}>Newer requests</Link>}
            <span>Page {page} of {totalPages}</span>
            {page < totalPages && <Link className="underline" href={`/me/requests?page=${page + 1}`}>Older requests</Link>}
          </nav>}
        </section>
      </div>
    </>
  );
}
