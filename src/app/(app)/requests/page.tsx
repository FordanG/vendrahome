import Link from "next/link";
import { and, asc, count, desc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb, schema } from "@/db";
import { CAN, requireStaff } from "@/lib/auth";
import { centavosToInput, formatDate, formatPeso, formatTimeRange, todayISO } from "@/lib/format";
import { REQUEST_KIND_LABELS, REQUEST_STATUS_TONES, requestStatusLabel } from "@/lib/portal";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Empty, Field, FormGrid, Input, PageHeader, Select, Textarea, ViewTabs } from "@/components/ui";
import { canHandleRequest } from "@/lib/service-work";
import { createStaffRequest, recordRepairCost, reportProblem, updateRequest } from "./actions";
import type { TenantRequest } from "@/db/schema";

const VIEWS = {
  open: { label: "Open", statuses: ["pending", "approved"] },
  pending: { label: "Needs a reply", statuses: ["pending"] },
  closed: { label: "Closed", statuses: ["declined", "done"] },
} satisfies Record<string, { label: string; statuses: TenantRequest["status"][] }>;
type View = keyof typeof VIEWS;

const reporter = alias(schema.staff, "reporter");
const PAID_BY_LABELS = { hotel: "the hotel", company: "the company", occupant: "the tenant" } as const;

const at = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" });

export default async function RequestsPage({ searchParams }: PageProps<"/requests">) {
  const user = await requireStaff();

  const canSeePeople = CAN.manageOccupants.includes(user.role);
  const params = await searchParams;
  const view: View = typeof params.view === "string" && params.view in VIEWS ? (params.view as View) : "open";

  const page = Math.max(1, Math.min(100000, Math.floor(Number(params.page) || 1)));
  const pageSize = 50;
  const scope = user.role === "maintenance" ? and(ne(schema.tenantRequests.kind, "laundry"), or(isNull(schema.tenantRequests.assigneeId), eq(schema.tenantRequests.assigneeId, user.id))) : undefined;
  const db = await getDb();
  const staff = await db.query.staff.findMany({ where: and(eq(schema.staff.active, true), ne(schema.staff.role, "tenant")), orderBy: [asc(schema.staff.name)] });
  const occupants = CAN.manageOccupants.includes(user.role) ? await db.query.occupants.findMany({ orderBy: [asc(schema.occupants.fullName)] }) : [];
  const rooms = await db.select({ id: schema.rooms.id, number: schema.rooms.number }).from(schema.rooms).orderBy(asc(schema.rooms.number));
  const canCharge = CAN.recordBilling.includes(user.role);
  const [rows, byStatus] = await Promise.all([
    db
      .select({
        r: schema.tenantRequests,
        name: schema.occupants.fullName,
        roomNumber: schema.rooms.number,
        areaName: schema.areas.name,
        handledBy: schema.staff.name,
        reportedBy: reporter.name,
      })
      .from(schema.tenantRequests)
      .leftJoin(schema.occupants, eq(schema.tenantRequests.occupantId, schema.occupants.id))
      .leftJoin(reporter, eq(schema.tenantRequests.reportedBy, reporter.id))
      .leftJoin(schema.rooms, eq(schema.tenantRequests.roomId, schema.rooms.id))
      .leftJoin(schema.areas, eq(schema.tenantRequests.areaId, schema.areas.id))
      .leftJoin(schema.staff, eq(schema.tenantRequests.handledBy, schema.staff.id))
      .where(and(inArray(schema.tenantRequests.status, VIEWS[view].statuses), scope))
      .orderBy(desc(schema.tenantRequests.urgent), asc(schema.tenantRequests.dueDate), asc(schema.tenantRequests.createdAt), asc(schema.tenantRequests.id))
      .limit(pageSize).offset((page - 1) * pageSize),
    db
      .select({ status: schema.tenantRequests.status, n: count() })
      .from(schema.tenantRequests)
      .where(scope).groupBy(schema.tenantRequests.status),
  ]);
  const countFor = (v: View) =>
    byStatus.filter((s) => (VIEWS[v].statuses as string[]).includes(s.status)).reduce((n, s) => n + s.n, 0);

  return (
    <>
      <PageHeader
        title="Requests"
        subtitle={user.role === "maintenance"
          ? "Repair requests assigned to you or waiting to be claimed. Updating an unassigned request assigns it to you."
          : "Problems tenants and staff reported, and maintenance visits tenants asked for."}
        actions={
          <ViewTabs
            items={(Object.keys(VIEWS) as View[]).map((v) => ({
              href: `/requests?view=${v}`,
              label: VIEWS[v].label,
              count: v === "closed" ? undefined : countFor(v),
              active: v === view,
            }))}
          />
        }
      />
      <Card className="mb-5">
        <details>
          <summary className="cursor-pointer font-semibold">Report a problem in a room</summary>
          <ActionForm action={reportProblem} submitLabel="Report" resetOnSuccess className="mt-3 space-y-4">
            <Field label="Room">
              <Select name="roomId" required defaultValue="">
                <option value="">Choose the room</option>
                {rooms.map((r) => <option key={r.id} value={r.id}>Room {r.number}</option>)}
              </Select>
            </Field>
            <Field label="What's wrong"><Textarea name="details" required maxLength={2000} /></Field>
            <Field label="Photo" hint="Optional"><Input name="photo" type="file" accept="image/*" /></Field>
            <label className="flex gap-2 text-sm"><input type="checkbox" name="urgent" />Urgent</label>
          </ActionForm>
        </details>
      </Card>
      {CAN.manageOccupants.includes(user.role) && <Card className="mb-5">
        <details><summary className="cursor-pointer font-semibold">Log a request for a tenant</summary>
          <ActionForm action={createStaffRequest} submitLabel="Log request" resetOnSuccess>
            <Field label="Tenant"><Select name="occupantId" required><option value="">Choose a tenant</option>{occupants.map(o => <option key={o.id} value={o.id}>{o.fullName}</option>)}</Select></Field>
            <Field label="Request type"><Select name="kind">{Object.entries(REQUEST_KIND_LABELS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label="Details"><Textarea name="details" required maxLength={2000} /></Field>
            <label className="flex gap-2"><input type="checkbox" name="urgent" />Urgent</label>
          </ActionForm>
        </details>
      </Card>}
      <p className="mb-3 text-sm text-muted">{countFor(view)} requests. Urgent work first, then due date and oldest first.</p>
      {rows.length === 0 && <Empty>{view === "closed" ? "No closed requests yet." : "All caught up. New requests from tenants show up here."}</Empty>}
      <div className="space-y-3">
        {rows.map(({ r, name, roomNumber, areaName, handledBy, reportedBy }) => {
          const canHandle = canHandleRequest(user, r) && !r.cancelledAt;
          const urgent = r.urgent && (r.status === "pending" || r.status === "approved");
          const when = [r.preferredDate && formatDate(r.preferredDate), r.preferredTime].filter(Boolean).join(", ");
          const set = r.scheduledDate
            ? [formatDate(r.scheduledDate), formatTimeRange(r.scheduledFrom, r.scheduledTo)].filter(Boolean).join(", ")
            : null;
          return (
            <article key={r.id} className="flex overflow-hidden rounded-xl border border-border bg-surface">
              <div
                className={`flex w-16 shrink-0 flex-col items-center gap-0.5 border-r px-1 py-3 text-center sm:w-20 ${
                  urgent ? "border-attention bg-attention text-attention-foreground" : "border-border bg-background/60"
                }`}
              >
                {areaName ? (
                  <span className="break-words text-xs font-semibold leading-tight">{areaName}</span>
                ) : (
                  <>
                    <span className={`text-[11px] ${urgent ? "text-attention-foreground/80" : "text-muted"}`}>Room</span>
                    <span className="plate text-2xl font-bold leading-none">{roomNumber ?? "?"}</span>
                  </>
                )}
                {urgent && <span className="mt-1 text-[11px] font-semibold">Urgent</span>}
              </div>
              <div className="min-w-0 flex-1 p-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <h2 className="font-semibold">{REQUEST_KIND_LABELS[r.kind]}</h2>
                  <Badge tone={REQUEST_STATUS_TONES[r.status]}>{requestStatusLabel(r)}</Badge>
                  <span className="text-xs text-muted sm:ml-auto">{at.format(r.createdAt)}</span>
                </div>
                <p className="mt-2 max-w-prose whitespace-pre-wrap text-sm">{r.details}</p>
                {r.photoId && (
                  <a className="mt-2 inline-block text-sm underline" href={`/api/photos/${r.photoId}`} target="_blank" rel="noreferrer">
                    See the photo
                  </a>
                )}
                <p className="mt-2 text-sm text-muted">
                  {r.occupantId ? (
                    <>
                      From{" "}
                      {canSeePeople ? (
                        <Link className="text-foreground underline underline-offset-2" href={`/occupants/${r.occupantId}`}>
                          {name}
                        </Link>
                      ) : (
                        <span className="text-foreground">{name}</span>
                      )}
                    </>
                  ) : (
                    <>Reported by <span className="text-foreground">{reportedBy ?? "staff"}</span></>
                  )}
                  {when && <>, asked for {when}</>}
                </p>
                <p className="mt-2 text-sm text-muted">Assigned to {staff.find(s => s.id === r.assigneeId)?.name ?? "Unassigned"}
                  {r.dueDate && <span className={r.dueDate < todayISO() && view !== "closed" ? "text-attention" : ""}> · Due {formatDate(r.dueDate)}</span>}
                </p>
                {(set || r.response) && (
                  <div className="mt-3 rounded-lg bg-background px-3 py-2 text-sm">
                    {set && <p className="font-medium">{r.status === "done" ? "Appointment date" : "Booked for"} {set}</p>}
                    {r.response && (
                      <p className={set ? "mt-0.5" : ""}>
                        {r.response}
                        {handledBy && <span className="text-muted"> ({handledBy})</span>}
                      </p>
                    )}
                  </div>
                )}
                {r.cost != null && (
                  <p className="mt-2 text-sm">
                    Repair cost {formatPeso(r.cost)}, paid by {PAID_BY_LABELS[r.paidBy ?? "hotel"]}
                    {r.chargeId && <span className="text-muted"> (charged in Billing)</span>}
                  </p>
                )}
                {canHandle && r.kind !== "laundry" && !r.chargeId && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm underline underline-offset-2">{r.cost == null ? "Record the repair cost" : "Change the repair cost"}</summary>
                    <ActionForm action={recordRepairCost.bind(null, r.id)} submitLabel="Save cost" className="mt-3 flex flex-wrap items-end gap-3">
                      <Field label="Cost, parts and labour">
                        <Input name="cost" inputMode="decimal" defaultValue={centavosToInput(r.cost)} required className="w-32" />
                      </Field>
                      <Field label="Who pays">
                        <Select name="paidBy" defaultValue={r.paidBy ?? "hotel"}>
                          <option value="hotel">The hotel</option>
                          {canCharge && <option value="company">The company (adds a charge)</option>}
                          {canCharge && r.occupantId && <option value="occupant">The tenant (adds a charge)</option>}
                        </Select>
                      </Field>
                    </ActionForm>
                  </details>
                )}
                {canHandle && (
                  <details className="group mt-3">
                    <summary className="inline-flex cursor-pointer select-none items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:border-accent/40 group-open:border-accent/40 group-open:bg-background">
                      {r.status === "pending" ? (r.kind === "issue" ? "Reply" : "Approve or decline") : "Update"}
                    </summary>
                    <div className="mt-3 rounded-lg border border-border p-3">
                      <ActionForm action={updateRequest.bind(null, r.id)}>
                        <FormGrid>
                          {user.role !== "maintenance" && <Field label="Assigned to">
                            <Select name="assigneeId" defaultValue={r.assigneeId ?? ""}><option value="">Unassigned</option>{staff.filter(s => r.kind !== "laundry" || s.role !== "maintenance").map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
                          </Field>}
                          <Field label="Due date"><Input type="date" name="dueDate" defaultValue={r.dueDate ?? ""} /></Field>
                          <Field label="Status">
                            <Select name="status" defaultValue={r.status === "pending" ? "approved" : r.status}>
                              {(["pending", "approved", "declined", "done"] as const).map((s) => (
                                <option key={s} value={s}>
                                  {requestStatusLabel({ kind: r.kind, status: s })}
                                </option>
                              ))}
                            </Select>
                          </Field>
                          <Field
                            label={r.kind === "issue" ? "Repair date (optional)" : "Date you're approving"}
                            hint={r.kind === "maintenance" ? "Approving books a maintenance visit for the room." : undefined}
                          >
                            <Input name="scheduledDate" type="date" defaultValue={r.scheduledDate ?? r.preferredDate ?? ""} />
                          </Field>
                          <Field label="From">
                            <Input name="timeFrom" type="time" defaultValue={r.scheduledFrom ?? ""} />
                          </Field>
                          <Field label="To">
                            <Input name="timeTo" type="time" defaultValue={r.scheduledTo ?? ""} />
                          </Field>
                          <Field label="Reply to the tenant" hint="They see this in the app" className="sm:col-span-2">
                            <Input name="response" defaultValue={r.response ?? ""} />
                          </Field>
                        </FormGrid>
                      </ActionForm>
                    </div>
                  </details>
                )}
              </div>
            </article>
          );
        })}
      </div>
      <nav className="mt-5 flex gap-5" aria-label="Request pages">
        {page > 1 && <Link className="underline" href={`/requests?view=${view}&page=${page - 1}`}>Previous</Link>}
        <span>Page {page}</span>
        {page * pageSize < countFor(view) && <Link className="underline" href={`/requests?view=${view}&page=${page + 1}`}>Next</Link>}
      </nav>
    </>
  );
}
