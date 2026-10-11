import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireCompany } from "@/lib/auth";
import { companyRequestScope, companyRooms } from "@/lib/company";
import { REQUEST_KIND_LABELS, REQUEST_STATUS_TONES, requestStatusLabel } from "@/lib/portal";
import { addDaysISO, formatDate, formatMoment, formatTimeRange, todayISO } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Empty, Field, Input, PageHeader, SectionTitle, Select, Textarea } from "@/components/ui";
import type { TenantRequest } from "@/db/schema";
import { reportRoomProblem, reviewRequest } from "../actions";

export default async function CompanyRequestsPage() {
  const { client } = await requireCompany();
  const today = todayISO();
  const db = await getDb();
  const scope = await companyRequestScope(client.id);
  const query = () =>
    db
      .select({ r: schema.tenantRequests, name: schema.occupants.fullName, number: schema.rooms.number })
      .from(schema.tenantRequests)
      .leftJoin(schema.occupants, eq(schema.tenantRequests.occupantId, schema.occupants.id))
      .leftJoin(schema.rooms, eq(schema.tenantRequests.roomId, schema.rooms.id));
  const [waiting, open, closed, rooms] = await Promise.all([
    query()
      .where(and(eq(schema.tenantRequests.awaitingCompany, true), eq(schema.tenantRequests.status, "pending"), scope))
      .orderBy(schema.tenantRequests.createdAt),
    query()
      .where(and(eq(schema.tenantRequests.awaitingCompany, false), inArray(schema.tenantRequests.status, ["pending", "approved"]), scope))
      .orderBy(desc(schema.tenantRequests.urgent), desc(schema.tenantRequests.createdAt)),
    query()
      .where(
        and(
          inArray(schema.tenantRequests.status, ["declined", "done"]),
          gte(schema.tenantRequests.createdAt, new Date(addDaysISO(today, -31) + "T16:00:00Z")),
          scope,
        ),
      )
      .orderBy(desc(schema.tenantRequests.createdAt))
      .limit(50),
    companyRooms(client.id, today),
  ]);

  return (
    <>
      <PageHeader title="Requests" subtitle="Problems and requests from your people and in your rooms." />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          {(client.approveRequests || waiting.length > 0) && (
            <section>
              <SectionTitle>Waiting for your OK</SectionTitle>
              {waiting.length === 0 ? (
                <Empty>Nothing to approve.</Empty>
              ) : (
                <div className="space-y-3">
                  {waiting.map(({ r, name, number }) => (
                    <Card key={r.id} className="border-brand p-3 sm:p-4">
                      <RequestSummary r={r} name={name} number={number} />
                      <ActionForm action={reviewRequest.bind(null, r.id)} submitLabel="Approve" pendingLabel="Saving…" className="mt-3 space-y-3">
                        <input type="hidden" name="decision" value="approve" />
                        <Field label="Note for the front desk" hint="Optional">
                          <Input name="note" maxLength={1000} />
                        </Field>
                      </ActionForm>
                      <details className="mt-3">
                        <summary className="cursor-pointer text-sm underline underline-offset-2">Decline</summary>
                        <ActionForm action={reviewRequest.bind(null, r.id)} submitLabel="Decline" submitVariant="danger" pendingLabel="Saving…" className="mt-3 space-y-3">
                          <input type="hidden" name="decision" value="decline" />
                          <Field label="Why" hint="The tenant sees this">
                            <Input name="note" maxLength={1000} required />
                          </Field>
                        </ActionForm>
                      </details>
                    </Card>
                  ))}
                </div>
              )}
            </section>
          )}

          <section>
            <SectionTitle>With the front desk</SectionTitle>
            {open.length === 0 ? (
              <Empty>No open requests.</Empty>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
                {open.map(({ r, name, number }) => (
                  <li key={r.id} className="px-4 py-3">
                    <RequestSummary r={r} name={name} number={number} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <SectionTitle>Closed in the last month</SectionTitle>
            {closed.length === 0 ? (
              <Empty>None.</Empty>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
                {closed.map(({ r, name, number }) => (
                  <li key={r.id} className="px-4 py-3">
                    <RequestSummary r={r} name={name} number={number} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <Card className="self-start">
          <SectionTitle>Report a problem in a room</SectionTitle>
          {rooms.length === 0 ? (
            <p className="text-sm text-muted">No rooms under an active contract.</p>
          ) : (
            <ActionForm action={reportRoomProblem} submitLabel="Send to the front desk" pendingLabel="Sending…" resetOnSuccess>
              <Field label="Room">
                <Select name="roomId" required defaultValue="">
                  <option value="">Pick a room</option>
                  {rooms.map(({ room, hotel }) => (
                    <option key={room.id} value={room.id}>
                      {hotel}, room {room.number}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="What's wrong">
                <Textarea name="details" rows={3} required maxLength={2000} />
              </Field>
              <Field label="Photo" hint="Optional">
                <Input name="photo" type="file" accept="image/*" />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="urgent" /> Urgent (safety, water, power, lock)
              </label>
            </ActionForm>
          )}
        </Card>
      </div>
    </>
  );
}

function RequestSummary({ r, name, number }: { r: TenantRequest; name: string | null; number: string | null }) {
  return (
    <div className="text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{REQUEST_KIND_LABELS[r.kind]}</span>
        <Badge tone={r.awaitingCompany ? "amber" : REQUEST_STATUS_TONES[r.status]}>
          {r.awaitingCompany
            ? "Waiting for your OK"
            : r.status === "pending" && !r.cancelledAt
              ? "With the front desk"
              : requestStatusLabel({ ...r, awaitingCompany: false })}
        </Badge>
        {r.urgent && <Badge tone="red">Urgent</Badge>}
      </div>
      <p className="mt-1 text-muted">
        {[number && `Room ${number}`, name ?? "Reported by staff", formatMoment(r.createdAt)].filter(Boolean).join(", ")}
      </p>
      <p className="mt-1 whitespace-pre-wrap">{r.details}</p>
      {r.preferredDate && <p className="mt-1 text-muted">Asked for {formatDate(r.preferredDate)}{r.preferredTime && `, ${r.preferredTime}`}</p>}
      {r.scheduledDate && r.status === "approved" && (
        <p className="mt-1">
          Booked for {formatDate(r.scheduledDate)}
          {(r.scheduledFrom || r.scheduledTo) && `, ${formatTimeRange(r.scheduledFrom, r.scheduledTo)}`}
        </p>
      )}
      {r.response && <p className="mt-1 text-muted">Reply: {r.response}</p>}
    </div>
  );
}
