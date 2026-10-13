import Link from "next/link";
import { CAN } from "@/lib/auth";
import { requireHotel } from "@/lib/hotel";
import { getAvailability, roomOn, type AvailRoom } from "@/lib/availability";
import { addDaysISO, daysBetween, formatDate, isISODate, todayISO } from "@/lib/format";
import { AutoSubmitInput, AutoSubmitSelect } from "@/components/auto-submit";
import { Button, Empty, Input, PageHeader } from "@/components/ui";

// Management's question: which rooms can we offer, and when does each one free up?
// Two kinds of answer: beds inside a company's lease (for its people), and whole rooms
// free to lease (for a new contract).

type View = "all" | "beds" | "beds30" | "lease" | "lease90";
const VIEWS: View[] = ["all", "beds", "beds30", "lease", "lease90"];
const BED_VIEWS: View[] = ["beds", "beds30"];

/** "today", "tomorrow", "in 12 days", "in 5 months". */
const inDays = (today: string, day: string) => {
  const n = daysBetween(today, day);
  if (n <= 0) return "today";
  if (n === 1) return "tomorrow";
  return n <= 60 ? `in ${n} days` : `in ${Math.round(n / 30.4)} months`;
};
const beds = (n: number) => `${n} ${n === 1 ? "bed" : "beds"}`;

/** First day a bed opens inside the current lease: today if one is free already. */
const nextBed = (r: AvailRoom, today: string) => (r.bedsFree > 0 ? today : r.nextBedFreeOn);
/** First day anything opens: a bed in the lease or the whole room. */
const nextOpening = (r: AvailRoom, today: string) => [nextBed(r, today), r.freeFrom].filter((x): x is string => !!x).sort()[0] ?? null;

// Rooms are listed in groups by how soon they open, nearest first.
const GROUPS = [
  { label: "Free now", upTo: 0 },
  { label: "This week", upTo: 7 },
  { label: "This month", upTo: 30 },
  { label: "Next 3 months", upTo: 90 },
  { label: "Later", upTo: Infinity },
];

// The room plate's colour says how soon it opens: now, within a month, later, or never/unknown.
const PLATE = {
  now: "bg-emerald-600 text-white border-emerald-600 dark:bg-emerald-500 dark:border-emerald-500 dark:text-black",
  soon: "bg-surface text-foreground border-2 border-emerald-600 dark:border-emerald-500",
  later: "bg-occupied text-occupied-foreground border-occupied",
  closed: "text-attention border-attention/60 bg-[repeating-linear-gradient(135deg,transparent_0_5px,color-mix(in_srgb,var(--attention)_14%,transparent)_5px_10px)]",
  unknown: "bg-transparent text-muted border-dashed border-muted/50",
};
const plateFor = (date: string | null, today: string, closed: boolean) =>
  closed ? PLATE.closed : !date ? PLATE.unknown : date <= today ? PLATE.now : daysBetween(today, date) <= 30 ? PLATE.soon : PLATE.later;

/** The one line that answers "when", for the view being looked at. */
function Headline({ r, view, today }: { r: AvailRoom; view: View; today: string }) {
  const bed = nextBed(r, today);
  const roomLine =
    r.unknownBecause === "out_of_service" ? (
      <span className="text-attention">Out of service</span>
    ) : !r.freeFrom ? (
      <span>Free date not known</span>
    ) : r.freeFrom <= today ? (
      <span className="text-emerald-700 dark:text-emerald-400">Free to lease now</span>
    ) : (
      <span>
        Free to lease {formatDate(r.freeFrom)} <span className="font-normal text-muted">· {inDays(today, r.freeFrom)}</span>
      </span>
    );
  const bedLine =
    r.bedsFree > 0 ? (
      <span className="text-emerald-700 dark:text-emerald-400">{beds(r.bedsFree)} free now</span>
    ) : bed ? (
      <span>
        Bed free {formatDate(bed)} <span className="font-normal text-muted">· {inDays(today, bed)}</span>
      </span>
    ) : (
      <span>Full until the lease ends</span>
    );
  // "All rooms" leads with whichever opens first: a bed in the lease or the whole room.
  const bedFirst = BED_VIEWS.includes(view) || (view === "all" && !!r.lease && (!r.freeFrom || (!!bed && bed < r.freeFrom)));
  return <span className="block text-[15px] font-semibold leading-snug">{bedFirst && r.lease ? bedLine : roomLine}</span>;
}

function OnDate({ r, on }: { r: AvailRoom; on: string }) {
  const then = roomOn(r, on, todayISO());
  return (
    <span className="block text-[15px] font-semibold leading-snug">
      {r.condition === "not_available" ? (
        <span className="text-attention">Out of service</span>
      ) : then.freeToLease ? (
        <span className="text-emerald-700 dark:text-emerald-400">Free to lease on {formatDate(on)}</span>
      ) : then.lease ? (
        then.bedsFree > 0 ? (
          <span className="text-emerald-700 dark:text-emerald-400">
            {beds(then.bedsFree)} free on {formatDate(on)}
          </span>
        ) : (
          <span>Full on {formatDate(on)}</span>
        )
      ) : (
        <span>Not leased, tenants still in on {formatDate(on)}</span>
      )}
      {then.lease && then.lease.id !== r.lease?.id && <span className="block text-xs font-normal text-muted">Leased to {then.lease.clientName} then</span>}
    </span>
  );
}

function RoomRow({ r, view, on, today, q }: { r: AvailRoom; view: View; on: string | null; today: string; q: string }) {
  // A search that found this room by a tenant's name opens the tenant list, so the name shows.
  const openTenants = !!q && [...r.tenants, ...r.booked].some((t) => t.fullName.toLowerCase().includes(q));
  const then = on ? roomOn(r, on, today) : null;
  // On a picked date the plate is green when something is free that day, grey when not.
  const key = on ? (then!.freeToLease || then!.bedsFree > 0 ? today : "9999-12-31") : keyFor(r, view, today);
  const leaving = r.tenants.find((t) => t.expectedCheckOut);
  const people = r.tenants.length + r.booked.length;
  return (
    <li className="px-4 py-3 sm:grid sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] sm:gap-6">
      <div className="flex min-w-0 gap-3">
        <Link
          href={`/rooms/${r.id}`}
          className={`plate flex h-12 w-14 shrink-0 items-center justify-center border text-lg font-bold ${plateFor(key, today, r.condition === "not_available")}`}
          aria-label={`Room ${r.number}`}
        >
          {r.number}
        </Link>
        <div className="min-w-0 flex-1">
          {on ? <OnDate r={r} on={on} /> : <Headline r={r} view={view} today={today} />}
          <span className="mt-0.5 block text-sm text-muted">
            {[`Floor ${r.floor}`, r.typeName, `${r.tenants.length} of ${beds(r.capacity)} taken${on ? " now" : ""}`, r.booked.length > 0 && `${r.booked.length} booked`]
              .filter(Boolean)
              .join(" · ")}
          </span>
          {r.condition === "needs_work" && <span className="block text-sm text-warn-foreground">Needs attention before anyone moves in</span>}
          {r.freeUntil && <span className="block text-sm text-muted">Free until {formatDate(r.freeUntil)}, then taken again</span>}
        </div>
      </div>
      <div className="mt-2 min-w-0 space-y-1 pl-[4.25rem] text-sm sm:mt-0 sm:pl-0">
        {r.lease ? (
          <span className="block">
            <Link className="underline-offset-2 hover:underline" href={`/contracts/${r.lease.id}`}>
              {r.lease.clientName}
            </Link>
            <span className="text-muted"> · lease ends {formatDate(r.lease.endDate)}</span>
          </span>
        ) : (
          <span className="block text-muted">Not leased</span>
        )}
        {r.nextLease && (
          <span className="block text-muted">
            Then {r.nextLease.clientName} from {formatDate(r.nextLease.startDate)}
          </span>
        )}
        {people > 0 && (
          <details className="group" open={openTenants}>
            <summary className="block min-h-9 cursor-pointer list-none py-1 text-muted hover:text-foreground sm:min-h-0 sm:py-0 [&::-webkit-details-marker]:hidden">
              <span aria-hidden className="mr-1.5 inline-block transition-transform group-open:rotate-90">›</span>
              {r.tenants.length > 0 && `${r.tenants.length} ${r.tenants.length === 1 ? "tenant" : "tenants"}`}
              {r.tenants.length > 0 && r.booked.length > 0 && ", "}
              {r.booked.length > 0 && `${r.booked.length} moving in`}
              {leaving?.expectedCheckOut && <span> · next move-out {formatDate(leaving.expectedCheckOut)}</span>}
            </summary>
            <ul className="mt-1 space-y-1 border-l-2 border-border pl-3">
              {r.tenants.map((t) => (
                <li key={t.assignmentId}>
                  <Link className="font-medium underline-offset-2 hover:underline" href={`/occupants/${t.occupantId}`}>
                    {t.fullName}
                  </Link>
                  <span className="block text-muted">
                    {t.expectedCheckOut ? `Moves out ${formatDate(t.expectedCheckOut)}` : t.leavesOn ? "No move-out date, stays until the lease ends" : "No move-out date"}
                  </span>
                </li>
              ))}
              {r.booked.map((b) => (
                <li key={b.assignmentId}>
                  <Link className="font-medium underline-offset-2 hover:underline" href={`/occupants/${b.occupantId}`}>
                    {b.fullName}
                  </Link>
                  <span className="block text-muted">Moves in {formatDate(b.checkIn)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </li>
  );
}

/** The date a room is listed under: its next bed in bed views, the whole room in lease views, else whichever is first. */
function keyFor(r: AvailRoom, view: View, today: string) {
  if (r.condition === "not_available") return null;
  if (BED_VIEWS.includes(view)) return nextBed(r, today);
  if (view === "all") return nextOpening(r, today);
  return r.freeFrom;
}

export default async function AvailabilityPage({ searchParams }: PageProps<"/availability">) {
  const { hotel } = await requireHotel(CAN.viewClients);
  const params = await searchParams;
  const text = (k: string) => (typeof params[k] === "string" ? (params[k] as string).trim() : "");
  const today = todayISO();
  const on = isISODate(text("on")) && text("on") > today ? text("on") : null;
  // A picked date opens on the beds free that day, the usual question behind it.
  const view: View = VIEWS.includes(text("view") as View) ? (text("view") as View) : on ? "beds" : "all";
  const q = text("q").toLowerCase();
  const floor = text("floor");
  const type = text("type");
  const need = Math.max(0, Math.min(9, Number(text("need")) || 0));

  const rooms = await getAvailability(today, hotel.id);
  const floors = [...new Set(rooms.map((r) => r.floor))].sort((a, b) => a - b);
  const types = [...new Set(rooms.map((r) => r.typeName).filter((t): t is string => !!t))].sort();
  const maxBeds = Math.max(1, ...rooms.map((r) => r.capacity));

  // Search and filters narrow the rooms first; the tiles then count what is left.
  const matches = (r: AvailRoom) =>
    (!floor || String(r.floor) === floor) &&
    (!type || r.typeName === type) &&
    (!need || r.capacity >= need) &&
    (!q ||
      [r.number, r.typeName, r.lease?.clientName, r.nextLease?.clientName, ...r.tenants.map((t) => t.fullName), ...r.booked.map((b) => b.fullName)]
        .some((s) => s?.toLowerCase().includes(q)));
  const pool = rooms.filter(matches);
  const by = (days: number) => addDaysISO(today, days);
  const onDay = on ? new Map(pool.map((r) => [r.id, roomOn(r, on, today)])) : null;
  const bedsFreeFor = (r: AvailRoom) => (onDay ? onDay.get(r.id)!.bedsFree : r.bedsFree);
  const filters: Record<View, (r: AvailRoom) => boolean> = onDay
    ? {
        all: () => true,
        beds: (r) => bedsFreeFor(r) >= Math.max(1, need),
        beds30: () => false,
        lease: (r) => onDay.get(r.id)!.freeToLease,
        lease90: () => false,
      }
    : {
        all: () => true,
        beds: (r) => r.bedsFree >= Math.max(1, need),
        beds30: (r) => !!nextBed(r, today) && nextBed(r, today)! <= by(30),
        lease: (r) => !!r.freeFrom && r.freeFrom <= today,
        lease90: (r) => !!r.freeFrom && r.freeFrom <= by(90),
      };
  const active: View = onDay && view === "beds30" ? "beds" : onDay && view === "lease90" ? "lease" : view;
  const shown = pool
    .filter(filters[active])
    .sort((a, b) =>
      onDay
        ? a.floor - b.floor || a.number.localeCompare(b.number, undefined, { numeric: true })
        : (keyFor(a, active, today) ?? "9999").localeCompare(keyFor(b, active, today) ?? "9999") || a.number.localeCompare(b.number, undefined, { numeric: true }),
    );

  const keep = { ...(on && { on }), ...(q && { q: text("q") }), ...(floor && { floor }), ...(type && { type }), ...(need && { need: String(need) }) };
  const href = (v: View) => `/availability?${new URLSearchParams({ ...keep, ...(v === "all" ? {} : { view: v }) })}`;
  const bedsNow = pool.reduce((n, r) => n + bedsFreeFor(r), 0);
  const tiles: { view: View; count: number; label: string; hint: string }[] = onDay
    ? [
        { view: "beds", count: pool.reduce((n, r) => n + bedsFreeFor(r), 0), label: `Beds free on ${formatDate(on)}`, hint: "Inside leases" },
        { view: "lease", count: pool.filter(filters.lease).length, label: "Rooms to lease", hint: `Free on ${formatDate(on)}` },
      ]
    : [
        { view: "beds", count: bedsNow, label: "Beds free now", hint: `In ${pool.filter(filters.beds).length} rooms` },
        { view: "beds30", count: pool.filter(filters.beds30).length, label: "Rooms with a bed", hint: "Free within 30 days" },
        { view: "lease", count: pool.filter(filters.lease).length, label: "Rooms to lease now", hint: "Whole room" },
        { view: "lease90", count: pool.filter(filters.lease90).length, label: "Rooms to lease", hint: "Free within 90 days" },
      ];
  const filtered = !!(q || floor || type || need);

  // Group by how soon each room opens; a picked date shows one list by floor instead.
  const groups = onDay
    ? [{ label: `On ${formatDate(on)}`, rooms: shown }]
    : [
        ...GROUPS.map((g, i) => ({
          label: g.label,
          rooms: shown.filter((r) => {
            const k = keyFor(r, active, today);
            if (!k) return false;
            const d = daysBetween(today, k);
            return d <= g.upTo && (i === 0 || d > GROUPS[i - 1].upTo);
          }),
        })),
        { label: "Not known or out of service", rooms: shown.filter((r) => !keyFor(r, active, today)) },
      ].filter((g) => g.rooms.length > 0);

  return (
    <>
      <PageHeader title="Availability" subtitle={`${hotel.name}, ${formatDate(today)}. When each room and bed frees up.`} />

      <form className="mb-4 space-y-2" role="search" aria-label="Find rooms">
        {active !== "all" && <input type="hidden" name="view" value={active} />}
        <div className="flex gap-2">
          <Input name="q" type="search" defaultValue={text("q")} placeholder="Room, tenant or company" aria-label="Search" className="min-w-0 flex-1 sm:max-w-sm" />
          <Button variant="secondary">Search</Button>
        </div>
        <div className={`grid gap-2 sm:flex sm:flex-wrap ${types.length > 1 ? "grid-cols-3" : "grid-cols-2"}`}>
          <AutoSubmitSelect name="floor" defaultValue={floor} aria-label="Floor" className="min-w-0 sm:w-36">
            <option value="">All floors</option>
            {floors.map((f) => (
              <option key={f} value={f}>
                Floor {f}
              </option>
            ))}
          </AutoSubmitSelect>
          {types.length > 1 ? (
            <AutoSubmitSelect name="type" defaultValue={type} aria-label="Room type" className="min-w-0 sm:w-40">
              <option value="">All types</option>
              {types.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </AutoSubmitSelect>
          ) : null}
          <AutoSubmitSelect name="need" defaultValue={need ? String(need) : ""} aria-label="Beds needed" className="min-w-0 sm:w-36">
            <option value="">Beds</option>
            {Array.from({ length: maxBeds }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n === 1 ? "1+ bed" : `${n}+ beds`}
              </option>
            ))}
          </AutoSubmitSelect>
          <label className={`flex items-center gap-2 text-sm ${types.length > 1 ? "col-span-3" : "col-span-2"} sm:col-span-1`}>
            <span className="shrink-0 text-muted">Free on</span>
            <AutoSubmitInput name="on" type="date" min={addDaysISO(today, 1)} defaultValue={on ?? ""} aria-label="Free on a later date" className="min-w-0 flex-1 sm:w-44 sm:flex-none" />
          </label>
        </div>
        {(filtered || on) && (
          <p className="text-sm text-muted">
            {on && <>Showing {formatDate(on)}. </>}
            <Link href={active === "all" ? "/availability" : `/availability?view=${active}`} className="underline underline-offset-2 hover:text-foreground">
              Clear {on && filtered ? "date and filters" : on ? "date" : "filters"}
            </Link>
          </p>
        )}
      </form>

      <nav aria-label="Show" className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tiles.map((t) => {
          const isActive = active === t.view;
          return (
            <Link
              key={t.view}
              href={isActive ? href("all") : href(t.view)}
              aria-current={isActive ? "page" : undefined}
              className={`flex min-h-20 flex-col justify-between border p-3 transition-colors ${
                isActive ? "border-foreground bg-accent text-accent-foreground" : "border-border bg-surface hover:border-muted/60"
              }`}
            >
              <span className={`text-sm leading-tight ${isActive ? "" : "text-muted"}`}>{t.label}</span>
              <span className="flex items-baseline justify-between gap-2">
                <span className="plate text-3xl font-bold leading-none">{t.count}</span>
                <span className={`text-right text-xs leading-tight ${isActive ? "opacity-80" : "text-muted"}`}>{t.hint}</span>
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="mb-2 flex items-baseline justify-between gap-3 text-sm">
        <p className="text-muted">
          {shown.length} {shown.length === 1 ? "room" : "rooms"}
          {active === "all" ? (onDay ? "" : ", soonest to open first") : ""}
        </p>
        {active !== "all" && (
          <Link href={href("all")} className="underline underline-offset-2">
            Show all rooms
          </Link>
        )}
      </div>

      {shown.length === 0 ? (
        <Empty>
          {filtered
            ? "No rooms match. Try another search or clear the filters."
            : BED_VIEWS.includes(active)
              ? "No beds free inside leases in this time."
              : "No room is free to lease in this time."}
        </Empty>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <section key={g.label} aria-label={g.label}>
              <h2 className="mb-2 flex items-baseline gap-2 text-sm font-semibold">
                {g.label}
                <span className="plate font-bold text-muted">{g.rooms.length}</span>
              </h2>
              <ul className="divide-y divide-border border border-border bg-surface">
                {g.rooms.map((r) => (
                  <RoomRow key={r.id} r={r} view={active} on={on} today={today} q={q} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
