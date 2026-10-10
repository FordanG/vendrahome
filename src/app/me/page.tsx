import Link from "next/link";
import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireTenant } from "@/lib/auth";
import { formatDate, formatPeso, formatTimeRange, todayISO } from "@/lib/format";
import { occupantAccount } from "@/lib/billing";
import { roomCleaning } from "@/lib/housekeeping";
import { LAUNDRY_STATUS_LABELS, loadLabel } from "@/lib/laundry";
import {
  appliesToRoom,
  getCurrentStay,
  getSchedule,
  REQUEST_KIND_LABELS,
  REQUEST_STATUS_TONES,
  requestStatusLabel,
} from "@/lib/portal";
import { Badge, Card, Detail, LinkButton, SectionTitle } from "@/components/ui";
import { isoWeekday, Timetable } from "./timetable";

export default async function TenantHomePage() {
  const { user, occupant } = await requireTenant();
  const today = todayISO();
  const db = await getDb();
  const [stay, schedule, requests, account] = await Promise.all([
    getCurrentStay(occupant.id),
    getSchedule(),
    db
      .select()
      .from(schema.tenantRequests)
      .where(
        and(
          eq(schema.tenantRequests.occupantId, occupant.id),
          inArray(schema.tenantRequests.status, ["pending", "approved"]),
        ),
      )
      .orderBy(desc(schema.tenantRequests.createdAt))
      .limit(5),
    occupantAccount(occupant.id),
  ]);
  const cleaning = stay ? await roomCleaning(stay.room.id, today) : null;
  // Bags not picked up yet.
  const laundry = await db
    .select()
    .from(schema.laundryLoads)
    .where(and(eq(schema.laundryLoads.occupantId, occupant.id), inArray(schema.laundryLoads.status, ["at_desk", "at_shop", "ready"])))
    .orderBy(asc(schema.laundryLoads.number));
  const visits = stay
    ? await db
        .select()
        .from(schema.maintenanceVisits)
        .where(
          and(
            eq(schema.maintenanceVisits.roomId, stay.room.id),
            eq(schema.maintenanceVisits.status, "scheduled"),
            gte(schema.maintenanceVisits.date, today),
          ),
        )
        .orderBy(asc(schema.maintenanceVisits.date), asc(schema.maintenanceVisits.timeFrom))
        .limit(10)
    : [];
  const mine = stay ? schedule.map((s) => s.e).filter((e) => appliesToRoom(e, stay.room)) : [];
  const weekday = isoWeekday(today);

  return (
    <>
      <div className="mb-5 flex flex-col gap-4 sm:mb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="plate break-words text-[1.75rem] font-bold leading-tight sm:text-3xl">Hi, {user.name.split(/\s+/)[0]}</h1>
          <p className="mt-1 text-sm text-muted">{formatDate(today)}</p>
        </div>
        <LinkButton href="/me/requests" className="min-h-12 text-base sm:min-h-0 sm:text-sm">
          Report a problem or ask for help
        </LinkButton>
      </div>
      <div className="space-y-5">
        {stay ? (
          <section className="flex items-stretch gap-4 rounded-xl border border-border bg-surface p-4 sm:gap-6 sm:p-5">
            <div
              className="flex w-28 shrink-0 flex-col items-center justify-center rounded-lg bg-occupied px-3 py-4 text-occupied-foreground shadow-[inset_0_0_0_3px_var(--brand)] sm:w-36"
              aria-label={`Room ${stay.room.number}`}
            >
              <span className="text-xs opacity-80">Room</span>
              <span className="plate text-5xl font-bold leading-none sm:text-6xl">{stay.room.number}</span>
              <span className="mt-1 text-xs opacity-80">Floor {stay.room.floor}</span>
            </div>
            <dl className="grid flex-1 content-center gap-3 sm:grid-cols-2">
              {stay.a.slot && <Detail label="Your bed">{stay.a.slot}</Detail>}
              <Detail label="Moved in">{formatDate(stay.a.checkIn)}</Detail>
              <Detail label="Expected to move out">{stay.a.expectedCheckOut ? formatDate(stay.a.expectedCheckOut) : null}</Detail>
              <Detail label="Keys and cards you have" empty="None recorded">{stay.a.keysIssued}</Detail>
              {cleaning?.next && <Detail label="Next room cleaning">{cleaning.next === today ? "Today" : formatDate(cleaning.next)}</Detail>}
            </dl>
          </section>
        ) : (
          <Card>
            <p className="text-sm text-muted">You don&apos;t have a room assigned right now. Please talk to the front desk.</p>
          </Card>
        )}

        {stay && (
          <Card>
            <SectionTitle>When staff will come to your room</SectionTitle>
            {visits.length === 0 ? (
              <p className="text-sm text-muted">Nothing scheduled.</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {visits.map((v) => (
                  <li key={v.id} className="flex flex-wrap items-baseline gap-x-3 py-2">
                    <span className="w-28 shrink-0 font-medium">
                      {v.date === today ? "Today" : formatDate(v.date)}
                    </span>
                    <span>{v.requestId ? (requests.some(r => r.id === v.requestId) ? "Visit you asked for" : "Room maintenance") : v.title}</span>
                    {formatTimeRange(v.timeFrom, v.timeTo) && (
                      <span className="text-muted">{formatTimeRange(v.timeFrom, v.timeTo)}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {stay && (
          <div className="grid gap-5 sm:grid-cols-2">
            <Card>
              <SectionTitle>Your kitchen times</SectionTitle>
              <Timetable entries={mine.filter((e) => e.kind === "kitchen")} today={weekday} />
            </Card>
            <Card>
              <SectionTitle actions={<Link className="text-sm text-muted underline" href="/me/laundry">Your laundry</Link>}>
                Laundry days
              </SectionTitle>
              {laundry.length > 0 && (
                <ul className="mb-3 space-y-1 text-sm">
                  {laundry.map((l) => (
                    <li key={l.id}>
                      <span className="plate font-bold">{loadLabel(l.number)}</span>: {LAUNDRY_STATUS_LABELS[l.status]}
                    </li>
                  ))}
                </ul>
              )}
              <Timetable entries={mine.filter((e) => e.kind === "laundry")} today={weekday} />
              <p className="mt-3 text-xs text-muted">Bring your bag to the front desk. The shop collects it at these times.</p>
            </Card>
          </div>
        )}

        <Card>
          <SectionTitle
            actions={
              <Link className="text-sm text-muted underline" href="/me/requests">
                All requests
              </Link>
            }
          >
            Your open requests
          </SectionTitle>
          {requests.length === 0 ? (
            <p className="text-sm text-muted">You have no open requests.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {requests.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="font-medium">{REQUEST_KIND_LABELS[r.kind]}</span>
                  <Badge tone={REQUEST_STATUS_TONES[r.status]}>{requestStatusLabel(r)}</Badge>
                  <span className="w-full truncate text-muted sm:w-auto sm:flex-1">{r.details}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Only charges the tenant pays personally (e.g. laundry); company-paid ones never show here. */}
        {(account.charges.length > 0 || account.payments.length > 0) && (
          <Card>
            <SectionTitle>Your charges</SectionTitle>
            <p className="mb-3 text-sm">
              {account.balance > 0 ? <>You owe <strong>{formatPeso(account.balance)}</strong>. Pay at the front desk.</>
                : account.balance < 0 ? <>You paid {formatPeso(-account.balance)} ahead.</>
                : "You're all paid up."}
            </p>
            <ul className="divide-y divide-border text-sm">
              {[...account.charges.map((c) => ({ id: c.charge.id, date: c.charge.chargedOn, what: c.charge.description, amount: c.charge.amount })),
                ...account.payments.map((p) => ({ id: p.payment.id, date: p.payment.receivedOn, what: p.payment.reversesId ? "Payment reversed" : "Payment received", amount: -p.payment.amount }))]
                .sort((a, b) => (a.date < b.date ? 1 : -1))
                .slice(0, 8)
                .map((row) => (
                  <li key={row.id} className="flex justify-between gap-3 py-2">
                    <span>{row.what}<span className="block text-xs text-muted">{formatDate(row.date)}</span></span>
                    <span className="tabular-nums">{row.amount < 0 ? `−${formatPeso(-row.amount)}` : formatPeso(row.amount)}</span>
                  </li>
                ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
