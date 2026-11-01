import Link from "next/link";
import { and, count, eq, lte } from "drizzle-orm";
import { requestScope } from "@/lib/service-work";
import { getDb, schema } from "@/db";
import { CAN } from "@/lib/auth";
import { requireHotel } from "@/lib/hotel";
import { getRoomBoard, STATUS_LABELS, type RoomStatus } from "@/lib/rooms";
import { STATUS_HELP } from "@/lib/room-status";
import { addDaysISO, daysBetween, formatDate, todayISO } from "@/lib/format";
import { SLOT, SWATCH } from "@/components/list";
import { Badge, LinkButton, PageHeader } from "@/components/ui";
import { FloorFolds } from "./floor-folds";

// The board reads like a front desk key rack: one fold per floor, one slot per room.
// Filled = someone lives there, outlined = contracted but empty, dashed = vacant.
// Slot styles live in components/list.tsx so room plates in lists match.

/** "Needs work" is a flag on top of occupancy: staff marked it, or tenants reported something. */
/** Short room type for the narrow slots: "Twin", "Loft", "Triple" -> "Tri". */
const shortType = (name: string | null) => (name && name.length > 5 ? name.slice(0, 3) : name);

const matches = (r: { status: RoomStatus; needsWork: boolean }, s: RoomStatus) =>
  s === "needs_work" ? r.needsWork : r.status === s;

/** How to read a room: small examples of each marker, in words. */
function BoardKey({ types }: { types: (string | null)[] }) {
  // Room types only show on the slots when there is more than one.
  const showTypes = types.length > 1;
  const example = "relative flex h-10 w-12 shrink-0 flex-col justify-between rounded-lg border px-1.5 py-1";
  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold">How to read a room</h2>
      <dl className="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
        <div className="flex items-center gap-3">
          <dt className={`${example} ${SLOT.occupied}`} aria-hidden>
            <span className="plate text-xs font-bold leading-none">203</span>
            {showTypes && <span className="text-[9px] leading-none opacity-90">Twin</span>}
          </dt>
          <dd>
            <span className="block font-medium">Someone lives here</span>
            <span className="block text-xs text-muted">{showTypes ? "Room number and type" : "Room number"}</span>
          </dd>
        </div>
        <div className="flex items-center gap-3">
          <dt className={`${example} ${SLOT.occupied}`} aria-hidden>
            <span className="plate text-xs font-bold leading-none">305</span>
            <span className="self-start rounded-full bg-emerald-600 px-1 text-[9px] font-semibold leading-3 text-white">1 free</span>
          </dt>
          <dd>
            <span className="block font-medium">Beds free to assign</span>
            <span className="block text-xs text-muted">Under the current contract</span>
          </dd>
        </div>
        <div className="flex items-center gap-3">
          <dt className={`${example} ${SLOT.occupied} ring-[3px] ring-warn ring-offset-1 ring-offset-surface`} aria-hidden>
            <span className="plate text-xs font-bold leading-none">110</span>
          </dt>
          <dd>
            <span className="block font-medium">Needs attention</span>
            <span className="block text-xs text-muted">A repair, cleaning or open request</span>
          </dd>
        </div>
        <div className="flex items-center gap-3">
          <dt className="flex w-12 shrink-0 justify-center gap-1" aria-hidden>
            <span className="rounded-full bg-warn px-1.5 text-[10px] font-bold leading-4 text-warn-foreground">2</span>
            <span className="rounded-full bg-attention px-1.5 text-[10px] font-bold leading-4 text-attention-foreground">1</span>
          </dt>
          <dd>
            <span className="block font-medium">Open requests</span>
            <span className="block text-xs text-muted">Red means one is urgent</span>
          </dd>
        </div>
      </dl>
      {showTypes && (
        <p className="mt-4 border-t border-border pt-3 text-xs text-muted">
          Room types: {types.map((t) => (shortType(t) === t ? t : `${t} (shown as ${shortType(t)})`)).join(", ")}.
        </p>
      )}
    </div>
  );
}

export default async function RoomBoardPage({ searchParams }: PageProps<"/">) {
  const { user, hotel } = await requireHotel();
  // Maintenance works on rooms, not people: no tenant names or lease notices on the board.
  const canSeePeople = CAN.manageOccupants.includes(user.role);
  const canSeeContracts = CAN.viewClients.includes(user.role);
  const params = await searchParams;
  const status = typeof params.status === "string" && params.status in STATUS_LABELS ? (params.status as RoomStatus) : null;
  const today = todayISO();

  const db = await getDb();
  const [all, [{ waiting }]] = await Promise.all([
    getRoomBoard(today, hotel.id),
    db.select({ waiting: count() }).from(schema.tenantRequests).where(and(eq(schema.tenantRequests.status, "pending"), requestScope(user, hotel.id))),
  ]);
  const floors = [...new Set(all.map((r) => r.floor))];
  const perFloor = Math.max(...floors.map((f) => all.filter((r) => r.floor === f).length), 1);
  const counts = Object.fromEntries(
    (Object.keys(STATUS_LABELS) as RoomStatus[]).map((s) => [s, all.filter((r) => matches(r, s)).length]),
  ) as Record<RoomStatus, number>;
  const people = all.reduce((n, r) => n + r.occupants.length, 0);
  const beds = all.reduce((n, r) => n + r.capacity, 0);
  const assignable = all.reduce((n, r) => n + r.assignableBeds, 0);
  const booked = all.reduce((n, r) => n + r.upcoming.length, 0);
  const types = [...new Set(all.map((r) => r.typeName).filter(Boolean))];

  const endingContracts = !canSeeContracts ? [] : await db.select({
    id: schema.contracts.id, reference: schema.contracts.reference, endDate: schema.contracts.endDate, clientName: schema.clients.name,
  }).from(schema.contracts).innerJoin(schema.clients, eq(schema.contracts.clientId, schema.clients.id))
    .where(and(eq(schema.contracts.status, "active"), eq(schema.contracts.propertyId, hotel.id), lte(schema.contracts.endDate, addDaysISO(today, 90))));
  const uncovered = canSeeContracts ? all.filter(r => r.occupants.length > 0 && !r.contract) : [];
  const checkOutsSoon = !canSeePeople ? [] : all.flatMap((r) =>
    r.occupants
      .filter((o) => o.expectedCheckOut && daysBetween(today, o.expectedCheckOut) <= 7)
      .map((o) => ({ ...o, room: r.number })),
  );
  // Notices on top of the board, most pressing first. The dot colour says how pressing.
  const notice = (dot: string) =>
    `relative py-3 pl-9 pr-4 before:absolute before:left-4 before:top-[1.15rem] before:size-2 before:rounded-full ${dot} sm:py-2.5 sm:before:top-[0.95rem]`;
  const notices = [
    waiting > 0 && (
      <li key="waiting" className={notice("before:bg-brand")}>
        <Link className="font-medium link" href="/requests?view=pending">
          {waiting} {waiting === 1 ? "request needs" : "requests need"} a reply
        </Link>{" "}
        waiting to be handled.
      </li>
    ),
    ...endingContracts.map((c) => (
      <li key={c.id} className={notice("before:bg-warn")}>
        Contract{" "}
        <Link className="font-medium link" href={`/contracts/${c.id}`}>
          {c.reference}
        </Link>{" "}
        for {c.clientName} {c.endDate < today ? "expired" : "ends"} {formatDate(c.endDate)}.{" "}
        {c.endDate < today ? "Resolve continuing stays or renew coverage." : `${daysBetween(today, c.endDate)} days left.`}
      </li>
    )),
    ...uncovered.map((r) => (
      <li key={r.id} className={notice("before:bg-attention")}>
        <Link className="link" href={`/rooms/${r.id}`}>
          Room {r.number}
        </Link>{" "}
        has tenants but no active contract covers it. Add the room to a contract.
      </li>
    )),
    ...checkOutsSoon.map((o) => (
      <li key={o.assignmentId} className={notice("before:bg-muted/50")}>
        <Link className="font-medium link" href={`/occupants/${o.occupantId}`}>
          {o.fullName}
        </Link>{" "}
        in room {o.room} is expected to move out on {formatDate(o.expectedCheckOut)}.
      </li>
    )),
  ].filter(Boolean);

  return (
    <>
      <PageHeader
        title="Room board"
        subtitle={
          canSeePeople
            ? `${hotel.name}, ${formatDate(today)}. ${people} tenants in ${beds} beds; ${assignable} free to give out${booked ? `, ${booked} booked for move-ins` : ""}.`
            : `${hotel.name}, ${formatDate(today)}. ${all.length} rooms.`
        }
        actions={
          canSeeContracts && (
            <LinkButton variant="secondary" href="/availability">
              When rooms free up
            </LinkButton>
          )
        }
      />

      {notices.length > 0 && (
        <div className="mb-6 overflow-hidden rounded-xl border border-border bg-surface text-sm shadow-card">
          <ul className="divide-y divide-border">{notices.slice(0, 2)}</ul>
          {/* On a phone the board should start near the top, so only the first two notices show until asked. */}
          {notices.length > 2 && (
            <details className="group border-t border-border">
              <summary className="cursor-pointer list-none px-4 py-3 font-medium text-muted hover:bg-subtle hover:text-foreground sm:py-2.5 [&::-webkit-details-marker]:hidden">
                <span className="group-open:hidden">Show {notices.length - 2} more</span>
                <span className="hidden group-open:inline">Show fewer</span>
              </summary>
              <ul className="divide-y divide-border border-t border-border">{notices.slice(2)}</ul>
            </details>
          )}
        </div>
      )}

      {/* Phones: one row that scrolls sideways, so the board starts higher up. */}
      <div
        className="no-print -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:mb-5 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0"
        role="group"
        aria-label="Show rooms by status"
      >
        {(Object.keys(STATUS_LABELS) as RoomStatus[]).map((s) => (
          <Link
            key={s}
            href={status === s ? "/" : `/?status=${s}`}
            aria-pressed={status === s}
            title={STATUS_HELP[s]}
            className={`flex min-h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3.5 py-1 text-sm transition sm:min-h-0 sm:py-1.5 ${
              status === s ? "border-foreground bg-surface shadow-card" : "border-border bg-surface/60 hover:border-field-border hover:bg-surface"
            } ${counts[s] === 0 ? "text-muted" : ""}`}
          >
            <span className={`size-3 rounded-[3px] ${SWATCH[s]}`} aria-hidden />
            {STATUS_LABELS[s]}
            <span className="plate font-bold">{counts[s]}</span>
          </Link>
        ))}
        {status && (
          <Link href="/" className="flex min-h-10 shrink-0 items-center whitespace-nowrap px-2 text-sm text-muted link sm:min-h-0">
            Show all
          </Link>
        )}
      </div>

      <FloorFolds
        floors={floors.map((f) => {
          const rooms = all.filter((r) => r.floor === f);
          const lived = rooms.filter((r) => r.status === "occupied").length;
          const freeBeds = rooms.reduce((n, r) => n + r.assignableBeds, 0);
          const flaggedRooms = rooms
            .map((r) => ({ id: r.id, number: r.number, urgent: r.openRequests.some((q) => q.urgent), flagged: r.needsWork }))
            .filter((r) => r.urgent || r.flagged)
            .sort((x, y) => Number(y.urgent) - Number(x.urgent));
          return {
            id: String(f),
            // Folded, a floor shows how full it is and names the rooms that need someone, urgent first.
            summary: (
              <>
                <span className="plate w-16 shrink-0 text-lg font-bold">Floor {f}</span>
                <span className="flex items-center gap-3">
                  <span className="h-1.5 w-20 overflow-hidden rounded-full bg-foreground/10 sm:w-28" aria-hidden>
                    <span className="block h-full rounded-full bg-occupied ring-1 ring-inset ring-foreground/10" style={{ width: `${(lived / rooms.length) * 100}%` }} />
                  </span>
                  <span className="whitespace-nowrap text-sm text-muted">
                    <span className="font-medium text-foreground">{lived} of {rooms.length}</span> occupied
                    {freeBeds > 0 && (
                      <>
                        , <span className="font-medium text-emerald-700 dark:text-emerald-400">{freeBeds} bed{freeBeds === 1 ? "" : "s"} free</span>
                      </>
                    )}
                    {status && <>, {rooms.filter((r) => matches(r, status)).length} {STATUS_LABELS[status].toLowerCase()}</>}
                  </span>
                </span>
                {flaggedRooms.length > 0 && (
                  <span className="flex flex-wrap gap-1.5 sm:ml-auto">
                    {flaggedRooms.slice(0, 4).map((r) => (
                      <Badge key={r.id} tone={r.urgent ? "red" : "amber"}>
                        <span className={`mr-1.5 size-1.5 rounded-full ${r.urgent ? "bg-attention" : "bg-warn"}`} aria-hidden />
                        Room {r.number}
                        {r.urgent ? ", urgent" : ""}
                      </Badge>
                    ))}
                    {flaggedRooms.length > 4 && <Badge>{flaggedRooms.length - 4} more</Badge>}
                  </span>
                )}
              </>
            ),
            // Slots per row follow the board's own width: a whole floor in one row when there is room
            // for it, half a floor per row on mid-size screens, five across on phones.
            rooms: (
              <div className="@container" aria-label={`Floor ${f}`} role="group">
                <div
                  className="grid grid-cols-5 gap-2 @xl:grid-cols-[repeat(var(--half),minmax(0,1fr))] @[56rem]:grid-cols-[repeat(var(--slots),minmax(0,1fr))]"
                  style={{ "--slots": perFloor, "--half": Math.ceil(perFloor / 2) } as React.CSSProperties}
                >
                  {rooms.map((r) => {
                    const dim = status && !matches(r, status);
                    const names = canSeePeople ? r.occupants.map((o) => o.fullName).join(", ") : "";
                    const flagged = r.needsWork && r.status !== "needs_work";
                    const blocked = r.condition === "not_available";
                    const urgent = r.openRequests.some((q) => q.urgent);
                    const label = [
                      `Room ${r.number}`,
                      r.typeName,
                      STATUS_LABELS[r.status],
                      blocked && "Out of service",
                      `${r.occupants.length} of ${r.capacity} beds taken`,
                      names,
                      r.openRequests.length > 0 && `${r.openRequests.length} open request${r.openRequests.length === 1 ? "" : "s"}`,
                      r.condition === "needs_work" && r.status !== "needs_work" && "Marked needs work",
                    ]
                      .filter(Boolean)
                      .join(". ");
                    return (
                      <Link
                        key={r.id}
                        href={`/rooms/${r.id}`}
                        title={label}
                        aria-label={label}
                        className={`relative flex h-16 flex-col justify-between rounded-lg border px-2 py-1.5 transition hover:-translate-y-0.5 hover:shadow-pop hover:ring-2 hover:ring-brand sm:h-[4.5rem] ${SLOT[r.status]} ${
                          flagged ? "ring-[3px] ring-warn ring-offset-1 ring-offset-surface" : ""
                        } ${blocked ? "ring-2 ring-attention" : ""} ${dim ? "opacity-20" : ""}`}
                      >
                        <span className="plate text-lg font-bold leading-none">{r.number}</span>
                        {/* The count sits on the slot's corner so it never squeezes the room number. */}
                        {r.openRequests.length > 0 && (
                          <span
                            className={`absolute -right-1.5 -top-1.5 min-w-5 rounded-full px-1 text-center text-[11px] font-bold leading-5 ring-2 ring-surface ${
                              urgent ? "bg-attention text-attention-foreground" : "bg-warn text-warn-foreground"
                            }`}
                          >
                            {r.openRequests.length}
                          </span>
                        )}
                        <span className="text-[11px] leading-tight">
                          {types.length > 1 && <span className="block truncate opacity-90">{shortType(r.typeName)}</span>}
                          {blocked && <span className="block font-semibold">Blocked</span>}
                          {r.assignableBeds > 0 && (
                            <span className="mt-0.5 inline-block whitespace-nowrap rounded-full bg-emerald-600 px-1.5 font-semibold leading-4 text-white">{r.assignableBeds} free</span>
                          )}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ),
          };
        })}
      />
      <div className="mt-4 rounded-xl border border-border bg-surface p-4 shadow-card sm:p-5">
        <BoardKey types={types} />
      </div>
    </>
  );
}
