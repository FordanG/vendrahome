import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN, getCurrentStaff, homeFor } from "@/lib/auth";
import { addDaysISO, formatDate, formatMoment, formatTimeRange, todayISO } from "@/lib/format";
import { visitPermission } from "@/lib/service-work";
import { ActionForm } from "@/components/action-form";
import { Brand } from "@/components/brand";
import { Card, SectionTitle } from "@/components/ui";
import { checkIn, finishVisit } from "./actions";

// Midnight in Manila (UTC+8) as a moment.
const startOfManilaDay = (iso: string) => new Date(addDaysISO(iso, -1) + "T16:00:00Z");

export const metadata = { title: "Room check-in" };

/**
 * Where a room's door code leads. Signed-out visitors sign in first and come back.
 * Tenants go to their requests page; staff check in at the room.
 */
export default async function RoomScanPage({ params }: PageProps<"/r/[token]">) {
  const { token } = await params;
  const user = await getCurrentStaff();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/r/${token}`)}`);
  if (user.role === "tenant") redirect("/me/requests");
  if (!CAN.checkInAtRooms.includes(user.role)) redirect(homeFor(user));

  const db = await getDb();
  const room = await db.query.rooms.findFirst({ where: eq(schema.rooms.qrToken, token) });
  if (!room) notFound();

  const today = todayISO();
  const [open, checkIns] = await Promise.all([
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
  ]);
  const permissions = await Promise.all(open.map((v) => visitPermission(user, v)));
  const visits = open.filter((_, i) => !permissions[i]);
  const mine = checkIns.filter(({ c }) => c.staffId === user.id);

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
        <section className="flex items-center gap-4">
          <div className="flex w-28 shrink-0 flex-col items-center justify-center rounded-lg bg-occupied px-3 py-4 text-occupied-foreground shadow-[inset_0_0_0_3px_var(--brand)]">
            <span className="text-xs opacity-80">Room</span>
            <span className="plate text-5xl font-bold leading-none">{room.number}</span>
            <span className="mt-1 text-xs opacity-80">Floor {room.floor}</span>
          </div>
          <div className="min-w-0">
            <h1 className="plate text-2xl font-bold leading-tight">Check in at Room {room.number}</h1>
            <p className="mt-1 text-sm text-muted">
              {mine[0] ? `You checked in at ${formatMoment(mine[0].c.at)}.` : "Tap the button once you're at the room."}
            </p>
          </div>
        </section>

        <Card>
          <ActionForm action={checkIn.bind(null, token)} submitLabel={`I'm at Room ${room.number}`} pendingLabel="Checking in…">
            {visits.length > 0 && (
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
            )}
            {visits.length === 0 && <p className="text-sm text-muted">No visits are scheduled for this room today. You can still check in.</p>}
          </ActionForm>
        </Card>

        {visits.length > 0 && CAN.manageVisits.includes(user.role) && (
          <Card>
            <SectionTitle>Finished?</SectionTitle>
            <ul className="divide-y divide-border">
              {visits.map((v) => {
                const checkedIn = mine.some(({ c }) => c.visitId === v.id);
                return (
                  <li key={v.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <span className="text-sm">
                      <span className="font-medium">{v.title}</span>
                      {!checkedIn && <span className="block text-xs text-muted">Not checked in for this visit yet</span>}
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
                );
              })}
            </ul>
          </Card>
        )}

        {checkIns.length > 0 && (
          <Card>
            <SectionTitle>Checked in here today</SectionTitle>
            <ul className="divide-y divide-border text-sm">
              {checkIns.map(({ c, name }) => (
                <li key={c.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                  <span>{c.staffId === user.id ? "You" : name}</span>
                  <span className="text-muted">{formatMoment(c.at)}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <p className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
          <Link className="underline underline-offset-2" href={`/rooms/${room.id}`}>Room details</Link>
          {CAN.viewInventory.includes(user.role) && (
            <Link className="underline underline-offset-2" href={`/inventory/rooms/${room.id}`}>Items in this room</Link>
          )}
        </p>
      </main>
    </div>
  );
}
