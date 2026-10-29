import Link from "next/link";
import { and, asc, count, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb, schema } from "@/db";
import { CAN, STAFF_ROLES } from "@/lib/auth";
import { requireHotel } from "@/lib/hotel";
import { centavosToInput, formatDate, formatPeso, formatTimeRange, todayISO } from "@/lib/format";
import { REQUEST_KIND_LABELS, REQUEST_STATUS_TONES, requestStatusLabel } from "@/lib/portal";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Empty, Field, FormGrid, Input, LinkButton, PageHeader, SectionTitle, Select, Textarea, ViewTabs } from "@/components/ui";
import { Icon } from "@/components/icons";
import { canHandleRequest, requestScope } from "@/lib/service-work";
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

const Plus = () => (
  <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

const at = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" });

export default async function RequestsPage({ searchParams }: PageProps<"/requests">) {
  const { user, hotel } = await requireHotel();

  const canSeePeople = CAN.manageOccupants.includes(user.role);
  const params = await searchParams;
  const view: View = typeof params.view === "string" && params.view in VIEWS ? (params.view as View) : "open";

  const page = Math.max(1, Math.min(100000, Math.floor(Number(params.page) || 1)));
  const pageSize = 50;
  const scope = requestScope(user, hotel.id);
  const db = await getDb();
  const staff = await db.query.staff.findMany({ where: and(eq(schema.staff.active, true), inArray(schema.staff.role, STAFF_ROLES), or(isNull(schema.staff.propertyId), eq(schema.staff.propertyId, hotel.id))), orderBy: [asc(schema.staff.name)] });
  const occupants = CAN.manageOccupants.includes(user.role) ? await db.query.occupants.findMany({ where: eq(schema.occupants.propertyId, hotel.id), orderBy: [asc(schema.occupants.fullName)] }) : [];
  const rooms = await db.select({ id: schema.rooms.id, number: schema.rooms.number }).from(schema.rooms).where(eq(schema.rooms.propertyId, hotel.id)).orderBy(asc(schema.rooms.number));
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

  const base = `/requests?view=${view}`;
  const adding = params.new === "problem" || (params.new === "request" && canSeePeople) ? params.new : null;

  return (
    <>
      <PageHeader
        title="Requests"
        subtitle={user.role === "maintenance"
          ? "Repair requests assigned to you or waiting to be claimed. Updating an unassigned request assigns it to you."
          : "Problems tenants and staff reported, and maintenance visits tenants asked for."}
        actions={
          <>
            <LinkButton variant="secondary" href={`${base}&new=problem`} scroll={false}>
              <Plus />
              Report a problem
            </LinkButton>
            {canSeePeople && (
              <LinkButton href={`${base}&new=request`} scroll={false}>
                <Plus />
                Log a request
              </LinkButton>
            )}
          </>
        }
      />
      {adding === "problem" && (
        <Card className="mb-5">
          <SectionTitle actions={<Link href={base} scroll={false} className="text-sm text-muted hover:text-foreground">Close</Link>}>
            Report a problem in a room
          </SectionTitle>
          <ActionForm action={reportProblem} submitLabel="Report" resetOnSuccess className="space-y-4">
            <FormGrid>
              <Field label="Room">
                <Select name="roomId" required defaultValue="">
                  <option value="">Choose the room</option>
                  {rooms.map((r) => <option key={r.id} value={r.id}>Room {r.number}</option>)}
                </Select>
              </Field>
              <Field label="Photo" hint="Optional"><Input name="photo" type="file" accept="image/*" /></Field>
            </FormGrid>
            <Field label="What's wrong"><Textarea name="details" required maxLength={2000} /></Field>
            <label className="flex gap-2 text-sm"><input type="checkbox" name="urgent" />Urgent</label>
          </ActionForm>
        </Card>
      )}
      {adding === "request" && (
        <Card className="mb-5">
          <SectionTitle actions={<Link href={base} scroll={false} className="text-sm text-muted hover:text-foreground">Close</Link>}>
            Log a request for a tenant
          </SectionTitle>
          <ActionForm action={createStaffRequest} submitLabel="Log request" resetOnSuccess className="space-y-4">
            <FormGrid>
              <Field label="Tenant"><Select name="occupantId" required><option value="">Choose a tenant</option>{occupants.map(o => <option key={o.id} value={o.id}>{o.fullName}</option>)}</Select></Field>
              <Field label="Request type"><Select name="kind">{Object.entries(REQUEST_KIND_LABELS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            </FormGrid>
            <Field label="Details"><Textarea name="details" required maxLength={2000} /></Field>
            <label className="flex gap-2 text-sm"><input type="checkbox" name="urgent" />Urgent</label>
          </ActionForm>
        </Card>
      )}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <ViewTabs
          items={(Object.keys(VIEWS) as View[]).map((v) => ({
            href: `/requests?view=${v}`,
            label: VIEWS[v].label,
            count: v === "closed" ? undefined : countFor(v),
            active: v === view,
          }))}
        />
        <p className="text-sm text-muted">Urgent first, then by due date and oldest.</p>
      </div>
      {rows.length === 0 && <Empty>{view === "closed" ? "No closed requests yet." : "All caught up. New requests from tenants show up here."}</Empty>}
      {rows.length > 0 && <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface shadow-card">
        {rows.map(({ r, name, roomNumber, areaName, handledBy, reportedBy }) => {
          const canHandle = canHandleRequest(user, r) && !r.cancelledAt;
          const urgent = r.urgent && (r.status === "pending" || r.status === "approved");
          const waiting = r.status === "pending" && !!r.occupantId;
          const when = [r.preferredDate && formatDate(r.preferredDate), r.preferredTime].filter(Boolean).join(", ");
          const set = r.scheduledDate
            ? [formatDate(r.scheduledDate), formatTimeRange(r.scheduledFrom, r.scheduledTo)].filter(Boolean).join(", ")
            : null;
          const assignee = staff.find((s) => s.id === r.assigneeId)?.name;
          const late = r.dueDate && r.dueDate < todayISO() && view !== "closed";
          return (
            <article key={r.id} className={`flex gap-3 px-4 py-4 sm:gap-4 sm:px-5 ${urgent ? "bg-attention/[0.04]" : ""}`}>
              {/* Where: the room number like its door plate, or the shared area's name. */}
              <div
                className={`flex h-12 w-14 shrink-0 flex-col items-center justify-center rounded-lg border px-1 text-center ${
                  urgent ? "border-attention/40 bg-attention/10 text-attention" : "border-border bg-subtle"
                }`}
              >
                {areaName ? (
                  <span className="line-clamp-2 text-[11px] font-semibold leading-tight">{areaName}</span>
                ) : (
                  <>
                    <span className="sr-only">Room </span>
                    <span className="plate text-xl font-bold leading-none">{roomNumber ?? "?"}</span>
                  </>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  {urgent && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-attention px-2 py-0.5 text-xs font-semibold text-attention-foreground">
                      <span className="size-1.5 rounded-full bg-current" aria-hidden />
                      Urgent
                    </span>
                  )}
                  <Badge tone={REQUEST_STATUS_TONES[r.status]}>{requestStatusLabel(r)}</Badge>
                  <span className="text-xs text-muted">{REQUEST_KIND_LABELS[r.kind]}</span>
                  <span className="ml-auto whitespace-nowrap text-xs text-muted">{at.format(r.createdAt)}</span>
                </div>

                <p className="mt-2 max-w-prose whitespace-pre-wrap text-[15px] font-medium leading-snug">{r.details}</p>

                <p className="mt-1.5 text-sm text-muted">
                  {r.occupantId ? (
                    <>
                      From{" "}
                      {canSeePeople ? (
                        <Link className="text-foreground link" href={`/occupants/${r.occupantId}`}>
                          {name}
                        </Link>
                      ) : (
                        <span className="text-foreground">{name}</span>
                      )}
                    </>
                  ) : (
                    <>Reported by <span className="text-foreground">{reportedBy ?? "staff"}</span></>
                  )}
                  {when && <>, asked for {when}</>}.{" "}
                  {assignee ? <>Assigned to <span className="text-foreground">{assignee}</span>.</> : "Nobody assigned yet."}
                  {r.dueDate && <span className={late ? "font-medium text-attention" : ""}> Due {formatDate(r.dueDate)}.</span>}
                  {r.photoId && (
                    <>
                      {" "}
                      <a className="text-foreground link" href={`/api/photos/${r.photoId}`} target="_blank" rel="noreferrer">
                        See the photo
                      </a>
                    </>
                  )}
                </p>

                {(set || r.response) && (
                  <div className="mt-3 flex gap-2.5 rounded-lg border border-border bg-subtle px-3 py-2.5 text-sm">
                    <Icon name={set ? "calendar" : "requests"} className="mt-0.5 size-4 shrink-0 text-muted" />
                    <div className="min-w-0">
                      {set && <p className="font-medium">{r.status === "done" ? "Appointment date" : "Booked for"} {set}</p>}
                      {r.response && (
                        <p className={set ? "mt-0.5 text-muted" : ""}>
                          {r.response}
                          {handledBy && <span className="text-muted"> ({handledBy})</span>}
                        </p>
                      )}
                    </div>
                  </div>
                )}
                {r.cost != null && (
                  <p className="mt-2 text-sm">
                    Repair cost {formatPeso(r.cost)}, paid by {PAID_BY_LABELS[r.paidBy ?? "hotel"]}
                    {r.chargeId && <span className="text-muted"> (charged in Billing)</span>}
                  </p>
                )}

                {canHandle && (
                  <div className="mt-3 flex flex-wrap items-start gap-x-4 gap-y-3">
                    {r.kind !== "laundry" && !r.chargeId && (
                      <details className="open:w-full">
                        <summary className="flex min-h-9 items-center text-sm text-muted hover:text-foreground">
                          {r.cost == null ? "Record the repair cost" : "Change the repair cost"}
                        </summary>
                        <ActionForm action={recordRepairCost.bind(null, r.id)} submitLabel="Save cost" className="mt-2 flex flex-wrap items-end gap-3 rounded-lg border border-border p-3">
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
                    <details className="group ml-auto open:w-full">
                      <summary
                        className={`ml-auto flex min-h-11 w-fit select-none items-center gap-1.5 rounded-lg border px-4 text-sm font-medium shadow-card transition sm:min-h-9 sm:px-3.5 ${
                          waiting
                            ? "border-transparent bg-accent text-accent-foreground hover:bg-brand hover:text-brand-foreground"
                            : "border-border bg-surface hover:bg-subtle"
                        }`}
                      >
                        {waiting ? (r.kind === "issue" ? "Reply" : "Approve or decline") : "Update"}
                      </summary>
                      <div className="mt-3 rounded-lg border border-border bg-subtle p-3 sm:p-4">
                        <ActionForm action={updateRequest.bind(null, r.id)}>
                          <FormGrid>
                            {user.role !== "maintenance" && <Field label="Assigned to">
                              <Select name="assigneeId" defaultValue={r.assigneeId ?? ""}><option value="">Nobody yet</option>{staff.filter(s => r.kind !== "laundry" || s.role !== "maintenance").map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
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
                            <Field label={r.occupantId ? "Reply to the tenant" : "Note"} hint={r.occupantId ? "They see this in the app" : undefined} className="sm:col-span-2">
                              <Input name="response" defaultValue={r.response ?? ""} />
                            </Field>
                          </FormGrid>
                        </ActionForm>
                      </div>
                    </details>
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>}
      <nav className="mt-5 flex gap-5 text-sm" aria-label="Request pages">
        {page > 1 && <Link className="link" href={`/requests?view=${view}&page=${page - 1}`}>Previous</Link>}
        {(page > 1 || page * pageSize < countFor(view)) && <span>Page {page}</span>}
        {page * pageSize < countFor(view) && <Link className="link" href={`/requests?view=${view}&page=${page + 1}`}>Next</Link>}
      </nav>
    </>
  );
}
