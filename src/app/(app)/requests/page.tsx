import Link from "next/link";
import { count, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN, requireStaff } from "@/lib/auth";
import { formatDate, formatTimeRange } from "@/lib/format";
import { REQUEST_KIND_LABELS, REQUEST_STATUS_TONES, requestStatusLabel } from "@/lib/portal";
import { ActionForm } from "@/components/action-form";
import { Badge, Empty, Field, FormGrid, Input, PageHeader, Select, ViewTabs } from "@/components/ui";
import { updateRequest } from "./actions";
import type { TenantRequest } from "@/db/schema";

const VIEWS = {
  open: { label: "Open", statuses: ["pending", "approved"] },
  pending: { label: "Needs a reply", statuses: ["pending"] },
  closed: { label: "Closed", statuses: ["declined", "done"] },
} satisfies Record<string, { label: string; statuses: TenantRequest["status"][] }>;
type View = keyof typeof VIEWS;

const at = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" });

export default async function RequestsPage({ searchParams }: PageProps<"/requests">) {
  const user = await requireStaff();
  const canHandle = CAN.handleRequests.includes(user.role);
  const canSeePeople = CAN.manageOccupants.includes(user.role);
  const params = await searchParams;
  const view: View = typeof params.view === "string" && params.view in VIEWS ? (params.view as View) : "open";

  const db = await getDb();
  const [rows, byStatus] = await Promise.all([
    db
      .select({
        r: schema.tenantRequests,
        name: schema.occupants.fullName,
        roomNumber: schema.rooms.number,
        handledBy: schema.staff.name,
      })
      .from(schema.tenantRequests)
      .innerJoin(schema.occupants, eq(schema.tenantRequests.occupantId, schema.occupants.id))
      .leftJoin(schema.rooms, eq(schema.tenantRequests.roomId, schema.rooms.id))
      .leftJoin(schema.staff, eq(schema.tenantRequests.handledBy, schema.staff.id))
      .where(inArray(schema.tenantRequests.status, VIEWS[view].statuses))
      .orderBy(desc(schema.tenantRequests.urgent), desc(schema.tenantRequests.createdAt))
      .limit(200),
    db
      .select({ status: schema.tenantRequests.status, n: count() })
      .from(schema.tenantRequests)
      .groupBy(schema.tenantRequests.status),
  ]);
  const countFor = (v: View) =>
    byStatus.filter((s) => (VIEWS[v].statuses as string[]).includes(s.status)).reduce((n, s) => n + s.n, 0);

  return (
    <>
      <PageHeader
        title="Tenant requests"
        subtitle="Problems tenants reported, and maintenance or laundry they asked for outside the usual schedule."
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
      {rows.length === 0 && <Empty>{view === "closed" ? "No closed requests yet." : "All caught up. New requests from tenants show up here."}</Empty>}
      <div className="space-y-3">
        {rows.map(({ r, name, roomNumber, handledBy }) => {
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
                <span className={`text-[11px] ${urgent ? "text-attention-foreground/80" : "text-muted"}`}>Room</span>
                <span className="plate text-2xl font-bold leading-none">{roomNumber ?? "–"}</span>
                {urgent && <span className="mt-1 text-[11px] font-semibold">Urgent</span>}
              </div>
              <div className="min-w-0 flex-1 p-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <h2 className="font-semibold">{REQUEST_KIND_LABELS[r.kind]}</h2>
                  <Badge tone={REQUEST_STATUS_TONES[r.status]}>{requestStatusLabel(r)}</Badge>
                  <span className="text-xs text-muted sm:ml-auto">{at.format(r.createdAt)}</span>
                </div>
                <p className="mt-2 max-w-prose whitespace-pre-wrap text-sm">{r.details}</p>
                <p className="mt-2 text-sm text-muted">
                  From{" "}
                  {canSeePeople ? (
                    <Link className="text-foreground underline underline-offset-2" href={`/occupants/${r.occupantId}`}>
                      {name}
                    </Link>
                  ) : (
                    <span className="text-foreground">{name}</span>
                  )}
                  {when && <>, asked for {when}</>}
                </p>
                {(set || r.response) && (
                  <div className="mt-3 rounded-lg bg-background px-3 py-2 text-sm">
                    {set && <p className="font-medium">Booked for {set}</p>}
                    {r.response && (
                      <p className={set ? "mt-0.5" : ""}>
                        {r.response}
                        {handledBy && <span className="text-muted"> ({handledBy})</span>}
                      </p>
                    )}
                  </div>
                )}
                {canHandle && (
                  <details className="group mt-3">
                    <summary className="inline-flex cursor-pointer select-none items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:border-accent/40 group-open:border-accent/40 group-open:bg-background">
                      {r.status === "pending" ? (r.kind === "issue" ? "Reply" : "Approve or decline") : "Update"}
                    </summary>
                    <div className="mt-3 rounded-lg border border-border p-3">
                      <ActionForm action={updateRequest.bind(null, r.id)}>
                        <FormGrid>
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
    </>
  );
}
