import Link from "next/link";
import { CAN } from "@/lib/auth";
import { requireHotel } from "@/lib/hotel";
import { getAvailability, roomOn, type AvailRoom } from "@/lib/availability";
import { addDaysISO, daysBetween, formatDate, isISODate, todayISO } from "@/lib/format";
import { Badge, Button, Empty, Input, PageHeader, Table, Td, Th, ViewTabs } from "@/components/ui";

// Management's question: which rooms can we offer, and when does each one free up?

// Two questions, two pairs of views: beds for the leasing company's people, whole rooms for new leases.
type View = "all" | "beds" | "beds30" | "lease" | "lease90";
const VIEWS: View[] = ["all", "beds", "beds30", "lease", "lease90"];

/** "today", "tomorrow", "in 12 days", "in 5 months". */
const inDays = (today: string, day: string) => {
  const n = daysBetween(today, day);
  if (n <= 0) return "today";
  if (n === 1) return "tomorrow";
  return n <= 60 ? `in ${n} days` : `in ${Math.round(n / 30.4)} months`;
};

/** First day a bed opens inside the current lease: today if one is free already. */
const nextBed = (r: AvailRoom, today: string) => (r.bedsFree > 0 ? today : r.nextBedFreeOn);
/** First day anything opens: a bed in the lease or the whole room. */
const nextOpening = (r: AvailRoom, today: string) => [nextBed(r, today), r.freeFrom].filter((x): x is string => !!x).sort()[0] ?? null;

function WhenFree({ r, today }: { r: AvailRoom; today: string }) {
  const bed = nextBed(r, today);
  const until = r.freeUntil && <span className="block text-xs text-muted">Until {formatDate(r.freeUntil)}, then taken again.</span>;
  return (
    <span className="block space-y-1.5">
      {r.lease && (
        <span className="block">
          {r.bedsFree > 0 ? (
            <Badge tone="green">
              {r.bedsFree} {r.bedsFree === 1 ? "bed" : "beds"} free now
            </Badge>
          ) : bed ? (
            <>
              <span className="font-medium">Next bed {formatDate(bed)}</span>
              <span className="block text-xs text-muted">{inDays(today, bed)}</span>
            </>
          ) : (
            <span className="text-muted">Beds full until the lease ends</span>
          )}
        </span>
      )}
      <span className="block">
        {r.unknownBecause === "out_of_service" ? (
          <Badge tone="red">Out of service</Badge>
        ) : !r.freeFrom ? (
          <>
            <Badge tone="amber">Room: not known</Badge>
            <span className="block text-xs text-muted">A tenant has no move-out date and no lease covers the room.</span>
          </>
        ) : r.freeFrom <= today ? (
          <>
            <Badge tone="green">Room free to lease now</Badge>
            {r.condition === "needs_work" && <span className="block text-xs text-muted">Needs attention before anyone moves in.</span>}
            {until}
          </>
        ) : (
          <>
            <span className={r.lease ? "text-sm" : "font-medium"}>Whole room {formatDate(r.freeFrom)}</span>
            <span className="block text-xs text-muted">{inDays(today, r.freeFrom)}</span>
            {until}
          </>
        )}
      </span>
    </span>
  );
}

export default async function AvailabilityPage({ searchParams }: PageProps<"/availability">) {
  const { hotel } = await requireHotel(CAN.viewClients);
  const params = await searchParams;
  const today = todayISO();
  const on = typeof params.on === "string" && isISODate(params.on) && params.on > today ? params.on : null;
  // A picked date opens on the beds free that day, the usual question behind it.
  const view: View = typeof params.view === "string" && VIEWS.includes(params.view as View) ? (params.view as View) : on ? "beds" : "all";

  const rooms = await getAvailability(today, hotel.id);
  const within = (days: number) => (r: AvailRoom) => !!r.freeFrom && r.freeFrom <= addDaysISO(today, days);
  const bedWithin = (days: number) => (r: AvailRoom) => !!nextBed(r, today) && nextBed(r, today)! <= addDaysISO(today, days);
  const onDay = on ? new Map(rooms.map((r) => [r.id, roomOn(r, on, today)])) : null;

  // Picking a date answers "what's free on that day"; otherwise the views count from today.
  const filters: Record<View, (r: AvailRoom) => boolean> = onDay
    ? {
        all: () => true,
        beds: (r) => onDay.get(r.id)!.bedsFree > 0,
        beds30: () => false,
        lease: (r) => onDay.get(r.id)!.freeToLease,
        lease90: () => false,
      }
    : { all: () => true, beds: bedWithin(0), beds30: bedWithin(30), lease: within(0), lease90: within(90) };
  const tabs: View[] = onDay ? ["beds", "lease", "all"] : ["beds", "beds30", "lease", "lease90", "all"];
  const active: View = onDay && view === "beds30" ? "beds" : onDay && view === "lease90" ? "lease" : view;
  // Soonest first: by the bed date in bed views, the whole-room date in lease views, else whichever opens first.
  const key = (r: AvailRoom) => (active === "beds" || active === "beds30" ? nextBed(r, today) : active === "all" ? nextOpening(r, today) : r.freeFrom) ?? "9999";
  const shown = rooms
    .filter(filters[active])
    .sort((a, b) => key(a).localeCompare(key(b)) || a.floor - b.floor || a.number.localeCompare(b.number, undefined, { numeric: true }));

  const freeNow = rooms.filter(within(0)).length;
  const beds = rooms.reduce((n, r) => n + r.bedsFree, 0);
  const bedsSoon = rooms.filter((r) => r.bedsFree === 0 && bedWithin(30)(r)).length;
  const label: Record<View, string> = onDay
    ? { beds: `Beds free on ${formatDate(on)}`, lease: "Rooms free to lease", all: "All rooms", beds30: "", lease90: "" }
    : { beds: "Beds free now", beds30: "Beds within 30 days", lease: "Rooms to lease now", lease90: "Rooms within 90 days", all: "All rooms" };
  const href = (v: View) => `/availability?${new URLSearchParams({ ...(on ? { on } : {}), ...(v === "all" && !on ? {} : { view: v }) })}`;

  return (
    <>
      <PageHeader
        title="Availability"
        subtitle={`${hotel.name}, ${formatDate(today)}. ${beds} ${beds === 1 ? "bed" : "beds"} free now inside leases, more in ${bedsSoon} ${bedsSoon === 1 ? "room" : "rooms"} within 30 days. ${freeNow} ${freeNow === 1 ? "room" : "rooms"} free to lease now.`}
      />

      <form className="mb-4 flex flex-wrap items-end gap-2" aria-label="Check a date">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm sm:flex-none">
          <span className="text-muted">What&apos;s free on a later date?</span>
          <Input name="on" type="date" min={addDaysISO(today, 1)} defaultValue={on ?? ""} required className="sm:w-48" />
        </label>
        <Button variant="secondary">Check</Button>
        {on && (
          <Link href="/availability" className="flex min-h-11 items-center px-2 text-sm text-muted underline underline-offset-2 sm:min-h-0">
            Back to today
          </Link>
        )}
      </form>

      <div className="mb-4">
        <ViewTabs items={tabs.map((v) => ({ href: href(v), label: label[v], count: rooms.filter(filters[v]).length, active: active === v }))} />
      </div>

      {shown.length === 0 ? (
        <Empty>
          {active === "beds" || active === "beds30"
            ? "No beds free inside leases in this time."
            : onDay
              ? `No room is free to lease on ${formatDate(on)}.`
              : "No room frees up in this time."}
        </Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Room</Th>
              {onDay && <Th>On {formatDate(on)}</Th>}
              <Th>When it&apos;s free</Th>
              <Th>Lease</Th>
              <Th>Tenants now</Th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const then = onDay?.get(r.id);
              return (
                <tr key={r.id} className="hover:bg-background">
                  <Td primary>
                    <Link className="plate font-bold hover:underline" href={`/rooms/${r.id}`}>
                      Room {r.number}
                    </Link>
                    <span className="block text-xs text-muted">
                      {[r.typeName, `${r.capacity} ${r.capacity === 1 ? "bed" : "beds"}`].filter(Boolean).join(", ")}
                    </span>
                  </Td>
                  {then && (
                    <Td label={`On ${formatDate(on)}`}>
                      {r.condition === "not_available" ? (
                        <Badge tone="red">Out of service</Badge>
                      ) : then.freeToLease ? (
                        <Badge tone="green">Free to lease</Badge>
                      ) : then.lease ? (
                        <span>
                          {then.bedsFree > 0 ? (
                            <Badge tone="green">{`${then.bedsFree} of ${r.capacity} ${r.capacity === 1 ? "bed" : "beds"} free`}</Badge>
                          ) : (
                            "Full"
                          )}
                          {then.lease.id !== r.lease?.id && <span className="block text-xs text-muted">Leased to {then.lease.clientName} then</span>}
                        </span>
                      ) : (
                        <span>Not leased, tenants still in</span>
                      )}
                    </Td>
                  )}
                  <Td label="When it's free">
                    <WhenFree r={r} today={today} />
                  </Td>
                  <Td label="Lease">
                    {r.lease ? (
                      <span>
                        <Link className="hover:underline" href={`/contracts/${r.lease.id}`}>
                          {r.lease.clientName}
                        </Link>
                        <span className="block text-xs text-muted">
                          Ends {formatDate(r.lease.endDate)}, {inDays(today, r.lease.endDate)}
                        </span>
                      </span>
                    ) : (
                      <span className="text-muted">Not leased</span>
                    )}
                    {r.nextLease && (
                      <span className="mt-1 block text-xs">
                        Next: {r.nextLease.clientName} from {formatDate(r.nextLease.startDate)}
                      </span>
                    )}
                  </Td>
                  <Td label="Tenants now" wide>
                    <span className="text-xs text-muted">
                      {r.tenants.length} of {r.capacity} {r.capacity === 1 ? "bed" : "beds"} taken
                      {r.booked.length > 0 && `, ${r.booked.length} booked`}
                    </span>
                    {r.tenants.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {r.tenants.map((t) => (
                          <li key={t.assignmentId}>
                            <Link className="hover:underline" href={`/occupants/${t.occupantId}`}>
                              {t.fullName}
                            </Link>
                            <span className="text-muted">
                              {", "}
                              {t.expectedCheckOut
                                ? `moves out ${formatDate(t.expectedCheckOut)}`
                                : t.leavesOn
                                  ? "no move-out date, so until the lease ends"
                                  : "no move-out date"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {r.booked.map((b) => (
                      <span key={b.assignmentId} className="mt-0.5 block">
                        <Link className="hover:underline" href={`/occupants/${b.occupantId}`}>
                          {b.fullName}
                        </Link>
                        <span className="text-muted">, moves in {formatDate(b.checkIn)}</span>
                      </span>
                    ))}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </>
  );
}
