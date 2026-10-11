import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { and, asc, desc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN, getCurrentStaff, homeFor } from "@/lib/auth";
import { canUseHotel } from "@/lib/hotel";
import { addDaysISO, formatDate, formatMoment, formatTimeRange, todayISO } from "@/lib/format";
import { REQUEST_STATUS_TONES, requestStatusLabel } from "@/lib/portal";
import { visitPermission } from "@/lib/service-work";
import { ActionForm } from "@/components/action-form";
import { Brand } from "@/components/brand";
import { Badge, Card, Field, Input, LinkButton, SectionTitle, Textarea } from "@/components/ui";
import { reportProblem } from "@/app/(app)/requests/actions";
import type { Area, CheckInPurpose, Room, Staff } from "@/db/schema";
import { checkIn, finishVisit, startChecklist, startCleaning, startItemsCheck, type DoorCheck } from "./actions";
import { roomChecklists } from "@/lib/checklists";

// Midnight in Manila (UTC+8) as a moment.
const startOfManilaDay = (iso: string) => new Date(addDaysISO(iso, -1) + "T16:00:00Z");

const PURPOSE_LABELS: Record<CheckInPurpose, string> = {
  visit: "Visit",
  cleaning: "Cleaning",
  inventory: "Items check",
  checklist: "Checklist",
  other: "Check-in",
};

const DOOR_CHECK_LABELS: Record<DoorCheck, string> = {
  move_in: "Move-in check",
  move_out: "Move-out check",
  spot: "Spot check",
};

export const metadata = { title: "Door code" };

/**
 * Where a door code leads. Signed-out visitors sign in first and come back.
 * Room codes: tenants go to their requests; staff pick what they're there to do.
 * Shared-space codes: tenants report a problem there; staff see what's been reported.
 */
export default async function ScanPage({ params }: PageProps<"/r/[token]">) {
  const { token } = await params;
  const user = await getCurrentStaff();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/r/${token}`)}`);

  const db = await getDb();
  const room = await db.query.rooms.findFirst({ where: eq(schema.rooms.qrToken, token) });
  const area = room ? null : await db.query.areas.findFirst({ where: and(eq(schema.areas.qrToken, token), eq(schema.areas.active, true)) });
  if (!room && !area) notFound();

  if (user.role === "tenant") redirect(area ? `/me/requests?area=${area.id}` : "/me/requests");
  if (!CAN.checkInAtRooms.includes(user.role)) redirect(homeFor(user));
  // Staff from another hotel get nothing here: the code isn't theirs to use.
  if (!canUseHotel(user, room?.propertyId ?? area?.propertyId)) notFound();

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-white/10 bg-sidebar pt-[env(safe-area-inset-top)] text-sidebar-foreground">
        <div className="mx-auto flex h-12 max-w-xl items-center justify-between gap-3 px-4">
          <Brand className="text-lg" />
          <Link href={homeFor(user)} className="text-sm text-sidebar-muted underline-offset-2 hover:text-sidebar-foreground hover:underline">
            Open the app
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-xl flex-1 space-y-5 px-4 pb-10 pt-5">
        {room ? <RoomView room={room} token={token} user={user} /> : <AreaView area={area!} />}
      </main>
    </div>
  );
}

function Plate({ top, big, bottom }: { top: string; big: string; bottom?: string }) {
  return (
    <div className="flex min-w-28 shrink-0 flex-col items-center justify-center rounded-lg bg-occupied px-3 py-4 text-occupied-foreground shadow-[inset_0_0_0_3px_var(--brand)]">
      <span className="text-xs opacity-80">{top}</span>
      <span className="plate text-5xl font-bold leading-none">{big}</span>
      {bottom && <span className="mt-1 text-xs opacity-80">{bottom}</span>}
    </div>
  );
}

function Heading({ plate, title, children }: { plate: ReactNode; title: string; children?: ReactNode }) {
  return (
    <section className="flex items-center gap-4">
      {plate}
      <div className="min-w-0">
        <h1 className="plate text-2xl font-bold leading-tight">{title}</h1>
        {children && <p className="mt-1 text-sm text-muted">{children}</p>}
      </div>
    </section>
  );
}

async function RoomView({ room, token, user }: { room: Room; token: string; user: Staff }) {
  const db = await getDb();
  const today = todayISO();
  const [open, checkIns, cleaning] = await Promise.all([
    // Today's visits and any overdue ones still open.
    db
      .select()
      .from(schema.maintenanceVisits)
      .where(and(eq(schema.maintenanceVisits.roomId, room.id), eq(schema.maintenanceVisits.status, "scheduled"), lte(schema.maintenanceVisits.date, today)))
      .orderBy(asc(schema.maintenanceVisits.date), asc(schema.maintenanceVisits.timeFrom)),
    db
      .select({ c: schema.roomCheckIns, name: schema.staff.name })
      .from(schema.roomCheckIns)
      .innerJoin(schema.staff, eq(schema.roomCheckIns.staffId, schema.staff.id))
      .where(and(eq(schema.roomCheckIns.roomId, room.id), gte(schema.roomCheckIns.at, startOfManilaDay(today))))
      .orderBy(desc(schema.roomCheckIns.at))
      .limit(10),
    db
      .select({ c: schema.cleanings, name: schema.staff.name })
      .from(schema.cleanings)
      .leftJoin(schema.staff, eq(schema.cleanings.staffId, schema.staff.id))
      .where(and(eq(schema.cleanings.roomId, room.id), isNull(schema.cleanings.finishedAt)))
      .limit(1)
      .then((rows) => rows[0]),
  ]);
  const permissions = await Promise.all(open.map((v) => visitPermission(user, v)));
  const visits = open.filter((_, i) => !permissions[i]);
  const mine = checkIns.filter(({ c }) => c.staffId === user.id);
  const checklists = CAN.runChecklists.includes(user.role) ? await roomChecklists(room.id, today) : [];

  return (
    <>
      <Heading plate={<Plate top="Room" big={room.number} bottom={`Floor ${room.floor}`} />} title={`Room ${room.number}`}>
        {mine[0] ? `You checked in at ${formatMoment(mine[0].c.at)}.` : "What are you here to do?"}
      </Heading>

      {CAN.cleanRooms.includes(user.role) && (
        <Card>
          <SectionTitle>Cleaning</SectionTitle>
          {cleaning && (
            <p className="mb-3 text-sm text-muted">
              Started {formatMoment(cleaning.c.startedAt)}
              {cleaning.name && ` by ${cleaning.name}`}, {cleaning.c.steps.filter((s) => s.done).length} of {cleaning.c.steps.length} steps done.
            </p>
          )}
          <ActionForm
            action={async () => {
              "use server";
              return startCleaning(token);
            }}
            submitLabel={cleaning ? "Continue cleaning" : "Clean this room"}
            pendingLabel="Opening checklist…"
            className="space-y-3"
          />
        </Card>
      )}

      <Card>
        <SectionTitle>Repair or maintenance visit</SectionTitle>
        <ActionForm action={checkIn.bind(null, token)} submitLabel={`I'm at Room ${room.number}`} pendingLabel="Checking in…">
          {visits.length > 0 ? (
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-medium">Which visit is this for?</legend>
              {visits.map((v, i) => (
                <label key={v.id} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-border p-3 text-sm has-checked:border-brand">
                  <input type="radio" name="visitId" value={v.id} defaultChecked={i === 0} className="mt-0.5" />
                  <span>
                    <span className="font-medium">{v.title}</span>
                    <span className="block text-muted">
                      {v.date === today ? "Today" : `${formatDate(v.date)}, overdue`}
                      {formatTimeRange(v.timeFrom, v.timeTo) && `, ${formatTimeRange(v.timeFrom, v.timeTo)}`}
                    </span>
                  </span>
                </label>
              ))}
              <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border p-3 text-sm has-checked:border-brand">
                <input type="radio" name="visitId" value="" />
                Not for a scheduled visit
              </label>
            </fieldset>
          ) : (
            <p className="text-sm text-muted">No visits are scheduled for this room today. You can still check in.</p>
          )}
        </ActionForm>
        {visits.length > 0 && CAN.manageVisits.includes(user.role) && (
          <div className="mt-5 border-t border-border pt-4">
            <p className="mb-2 text-sm font-medium">Finished the work?</p>
            <ul className="divide-y divide-border">
              {visits.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                  <span className="text-sm">
                    <span className="font-medium">{v.title}</span>
                    {!mine.some(({ c }) => c.visitId === v.id) && <span className="block text-xs text-muted">Not checked in for this visit yet</span>}
                  </span>
                  <ActionForm
                    action={async () => {
                      "use server";
                      return finishVisit(token, v.id);
                    }}
                    submitLabel="Mark done"
                    submitVariant="secondary"
                    className="flex flex-wrap items-center gap-3"
                  />
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {checklists.length > 0 && (
        <Card>
          <SectionTitle>Maintenance checklists</SectionTitle>
          <ul className="divide-y divide-border">
            {checklists.map((c) => (
              <li key={c.checklist.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <span className="text-sm">
                  <span className="font-medium">{c.checklist.name}</span>
                  <span className={`block text-xs ${c.daysLate > 0 ? "text-attention" : "text-muted"}`}>
                    {c.due > today ? `Next due ${formatDate(c.due)}` : c.daysLate > 0 ? `${c.daysLate} ${c.daysLate === 1 ? "day" : "days"} overdue` : "Due today"}
                  </span>
                </span>
                <ActionForm
                  action={async () => {
                    "use server";
                    return startChecklist(token, c.checklist.id);
                  }}
                  submitLabel="Start"
                  pendingLabel="Opening…"
                  submitVariant={c.due <= today ? "primary" : "secondary"}
                  className="flex items-center gap-3"
                />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {CAN.viewInventory.includes(user.role) && (
        <Card>
          <SectionTitle>Check the room&apos;s items</SectionTitle>
          <p className="mb-3 text-sm text-muted">Checks you in and opens the item list for this room.</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {(Object.keys(DOOR_CHECK_LABELS) as DoorCheck[]).map((kind) => (
              <ActionForm
                key={kind}
                action={async () => {
                  "use server";
                  return startItemsCheck(token, kind);
                }}
                submitLabel={DOOR_CHECK_LABELS[kind]}
                pendingLabel="Opening…"
                submitVariant="secondary"
                className="*:w-full *:*:w-full"
              />
            ))}
          </div>
        </Card>
      )}

      {CAN.handleRequests.includes(user.role) && (
        <Card>
          <details>
            <summary className="cursor-pointer text-[15px] font-semibold">Found a problem in this room?</summary>
            <ActionForm action={reportProblem} submitLabel="Report it" pendingLabel="Sending…" resetOnSuccess className="mt-3 space-y-3">
              <input type="hidden" name="roomId" value={room.id} />
              <Field label="What's wrong">
                <Textarea name="details" rows={2} required maxLength={2000} />
              </Field>
              <Field label="Photo" hint="Optional">
                <Input name="photo" type="file" accept="image/*" />
              </Field>
              <label className="flex min-h-11 items-center gap-2.5 text-sm">
                <input type="checkbox" name="urgent" /> Urgent
              </label>
            </ActionForm>
          </details>
        </Card>
      )}

      {checkIns.length > 0 && (
        <Card>
          <SectionTitle>Checked in here today</SectionTitle>
          <ul className="divide-y divide-border text-sm">
            {checkIns.map(({ c, name }) => (
              <li key={c.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <span>
                  {c.staffId === user.id ? "You" : name}
                  <span className="text-muted">, {PURPOSE_LABELS[c.purpose].toLowerCase()}</span>
                </span>
                <span className="text-muted">{formatMoment(c.at)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <p className="text-sm">
        <Link className="underline underline-offset-2" href={`/rooms/${room.id}`}>Room details</Link>
      </p>
    </>
  );
}

/** Staff scanning a shared space see what tenants have reported there. */
async function AreaView({ area }: { area: Area }) {
  const db = await getDb();
  const reports = await db
    .select({ r: schema.tenantRequests, name: schema.occupants.fullName })
    .from(schema.tenantRequests)
    .leftJoin(schema.occupants, eq(schema.tenantRequests.occupantId, schema.occupants.id))
    .where(and(eq(schema.tenantRequests.areaId, area.id), inArray(schema.tenantRequests.status, ["pending", "approved"]), eq(schema.tenantRequests.awaitingCompany, false)))
    .orderBy(desc(schema.tenantRequests.urgent), desc(schema.tenantRequests.createdAt));
  return (
    <>
      <Heading plate={area.floor != null && <Plate top="Floor" big={String(area.floor)} bottom="Shared space" />} title={area.name}>
        Tenants who scan this code can report a problem here.
      </Heading>
      <Card>
        <SectionTitle>Open problems reported here</SectionTitle>
        {reports.length === 0 ? (
          <p className="text-sm text-muted">Nothing open.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {reports.map(({ r, name }) => (
              <li key={r.id} className="py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={REQUEST_STATUS_TONES[r.status]}>{requestStatusLabel(r)}</Badge>
                  {r.urgent && <Badge tone="red">Urgent</Badge>}
                  <span className="text-muted">from {name}, {formatMoment(r.createdAt)}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap">{r.details}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <LinkButton href="/requests" variant="secondary">All requests</LinkButton>
    </>
  );
}
