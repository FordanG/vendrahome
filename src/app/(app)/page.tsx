import Link from "next/link";
import { count, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN, requireStaff } from "@/lib/auth";
import { getRoomBoard, STATUS_LABELS, type RoomStatus } from "@/lib/rooms";
import { STATUS_HELP } from "@/lib/room-status";
import { daysBetween, formatDate, todayISO } from "@/lib/format";
import { SLOT, SWATCH } from "@/components/list";
import { PageHeader } from "@/components/ui";
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
  const example = "relative flex h-9 w-12 shrink-0 flex-col justify-between rounded border px-1 py-0.5";
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold">How to read a room</h2>
      <dl className="grid gap-x-6 gap-y-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex items-center gap-2.5">
          <dt className={`${example} ${SLOT.occupied}`} aria-hidden>
            <span className="plate text-[11px] font-bold leading-none">203</span>
            {showTypes && <span className="text-[9px] leading-none">Twin</span>}
          </dt>
          <dd>{showTypes ? "Room number and room type." : "Room number."} Filled in means someone lives there.</dd>
        </div>
        <div className="flex items-center gap-2.5">
          <dt className={`${example} ${SLOT.occupied}`} aria-hidden>
            <span className="plate text-[11px] font-bold leading-none">305</span>
            <span className="text-[9px] font-semibold leading-none">1 free</span>
          </dt>
          <dd>Beds still free in the room. Nothing shown when every bed is taken.</dd>
        </div>
        <div className="flex items-center gap-2.5">
          <dt className={`${example} ${SLOT.occupied} ring-[3px] ring-warn ring-offset-1 ring-offset-surface`} aria-hidden>
            <span className="plate text-[11px] font-bold leading-none">110</span>
          </dt>
          <dd>Yellow border: the room needs attention (a repair, cleaning, or an open request).</dd>
        </div>
        <div className="flex items-center gap-2.5">
          <dt className="flex w-12 shrink-0 justify-center gap-1" aria-hidden>
            <span className="rounded-full bg-warn px-1.5 text-[10px] font-bold leading-4 text-warn-foreground">2</span>
            <span className="rounded-full bg-attention px-1.5 text-[10px] font-bold leading-4 text-attention-foreground">1</span>
          </dt>
          <dd>Number of open requests from tenants. Red means one is urgent.</dd>
        </div>
      </dl>
      {showTypes && (
        <p className="mt-3 text-xs text-muted">
          Room types: {types.map((t) => (shortType(t) === t ? t : `${t} (shown as ${shortType(t)})`)).join(", ")}.
        </p>
      )}
    </div>
  );
}

export default async function RoomBoardPage({ searchParams }: PageProps<"/">) {
  const user = await requireStaff();
  // Maintenance works on rooms, not people: no tenant names or lease notices on the board.
  const canSeePeople = CAN.manageOccupants.includes(user.role);
  const canSeeContracts = CAN.viewClients.includes(user.role);
  const params = await searchParams;
  const status = typeof params.status === "string" && params.status in STATUS_LABELS ? (params.status as RoomStatus) : null;
  const today = todayISO();

  const db = await getDb();
  const [all, [{ waiting }]] = await Promise.all([
    getRoomBoard(today),
    db.select({ waiting: count() }).from(schema.tenantRequests).where(eq(schema.tenantRequests.status, "pending")),
  ]);
  const floors = [...new Set(all.map((r) => r.floor))];
  const perFloor = Math.max(...floors.map((f) => all.filter((r) => r.floor === f).length), 1);
  const counts = Object.fromEntries(
    (Object.keys(STATUS_LABELS) as RoomStatus[]).map((s) => [s, all.filter((r) => matches(r, s)).length]),
  ) as Record<RoomStatus, number>;
  const people = all.reduce((n, r) => n + r.occupants.length, 0);
  const beds = all.reduce((n, r) => n + r.capacity, 0);
  const types = [...new Set(all.map((r) => r.typeName).filter(Boolean))];

  const endingContracts = !canSeeContracts ? [] : [
    ...new Map(
      all
        .filter((r) => r.contract && daysBetween(today, r.contract.endDate) <= 90)
        .map((r) => [r.contract!.id, r.contract!]),
    ).values(),
  ];
  const checkOutsSoon = !canSeePeople ? [] : all.flatMap((r) =>
    r.occupants
      .filter((o) => o.expectedCheckOut && daysBetween(today, o.expectedCheckOut) <= 7)
      .map((o) => ({ ...o, room: r.number })),
  );
  const hasNotices = waiting > 0 || endingContracts.length > 0 || checkOutsSoon.length > 0;

  return (
    <>
      <PageHeader
        title="Room board"
        subtitle={`${formatDate(today)}. ${people} tenants, ${beds - people} of ${beds} beds free.`}
      />

      {hasNotices && (
        <ul className="mb-6 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface text-sm">
          {waiting > 0 && (
            <li className="border-l-4 border-l-brand px-4 py-3 sm:py-2.5">
              <Link className="font-medium underline underline-offset-2" href="/requests?view=pending">
                {waiting} tenant request{waiting === 1 ? "" : "s"}
              </Link>{" "}
              waiting for a reply.
            </li>
          )}
          {endingContracts.map((c) => (
            <li key={c.id} className="border-l-4 border-l-warn px-4 py-3 sm:py-2.5">
              Contract{" "}
              <Link className="font-medium underline underline-offset-2" href={`/contracts/${c.id}`}>
                {c.reference}
              </Link>{" "}
              for {c.clientName} ends {formatDate(c.endDate)}, in {daysBetween(today, c.endDate)} days.
            </li>
          ))}
          {checkOutsSoon.map((o) => (
            <li key={o.assignmentId} className="border-l-4 border-l-border px-4 py-3 sm:py-2.5">
              <Link className="font-medium underline underline-offset-2" href={`/occupants/${o.occupantId}`}>
                {o.fullName}
              </Link>{" "}
              in room {o.room} is expected to move out on {formatDate(o.expectedCheckOut)}.
            </li>
          ))}
        </ul>
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
            className={`flex min-h-10 shrink-0 items-center gap-2 whitespace-nowrap border px-3 py-1 text-sm transition-colors sm:min-h-0 sm:py-1.5 ${
              status === s ? "border-foreground bg-surface" : "border-border hover:border-muted/60"
            } ${counts[s] === 0 ? "text-muted" : ""}`}
          >
            <span className={`size-3 rounded-[3px] ${SWATCH[s]}`} aria-hidden />
            {STATUS_LABELS[s]}
            <span className="plate font-bold">{counts[s]}</span>
          </Link>
        ))}
        {status && (
          <Link href="/" className="flex min-h-10 shrink-0 items-center whitespace-nowrap px-2 text-sm text-muted underline underline-offset-2 sm:min-h-0">
            Show all
          </Link>
        )}
      </div>

      <FloorFolds
        floors={floors.map((f) => {
          const rooms = all.filter((r) => r.floor === f);
          const lived = rooms.filter((r) => r.status === "occupied").length;
          const freeBeds = rooms.reduce((n, r) => n + (r.status === "not_available" ? 0 : r.capacity - r.occupants.length), 0);
          const attention = rooms.filter((r) => r.needsWork).length;
          const urgentCount = rooms.reduce((n, r) => n + r.openRequests.filter((q) => q.urgent).length, 0);
          return {
            id: String(f),
            // Folded, a floor still shows its rooms as a row of small squares, so nothing needing attention is hidden.
            summary: (
              <>
                <span className="plate w-16 shrink-0 text-lg font-bold">Floor {f}</span>
                <span className="flex flex-wrap gap-1 group-open:hidden" aria-hidden>
                  {rooms.map((r) => (
                    <span
                      key={r.id}
                      className={`size-3 ${SWATCH[r.status]} ${r.needsWork && r.status !== "needs_work" ? "ring-2 ring-warn" : ""} ${
                        status && !matches(r, status) ? "opacity-20" : ""
                      }`}
                    />
                  ))}
                </span>
                <span className="text-sm text-muted">
                  {lived} of {rooms.length} rooms occupied, {freeBeds} bed{freeBeds === 1 ? "" : "s"} free
                </span>
                {(attention > 0 || urgentCount > 0) && (
                  <span className="flex gap-1.5 sm:ml-auto">
                    {attention > 0 && (
                      <span className="whitespace-nowrap bg-warn px-1.5 text-xs font-semibold leading-5 text-warn-foreground">
                        {attention} need{attention === 1 ? "s" : ""} attention
                      </span>
                    )}
                    {urgentCount > 0 && (
                      <span className="whitespace-nowrap bg-attention px-1.5 text-xs font-semibold leading-5 text-attention-foreground">
                        {urgentCount} urgent
                      </span>
                    )}
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
                    const urgent = r.openRequests.some((q) => q.urgent);
                    const label = [
                      `Room ${r.number}`,
                      r.typeName,
                      STATUS_LABELS[r.status],
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
                        className={`relative flex h-16 flex-col justify-between rounded-md border px-2 py-1.5 transition-opacity hover:ring-2 hover:ring-brand sm:h-[4.5rem] ${SLOT[r.status]} ${
                          flagged ? "ring-[3px] ring-warn ring-offset-1 ring-offset-surface" : ""
                        } ${dim ? "opacity-20" : ""}`}
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
                          {r.status !== "not_available" && r.occupants.length < r.capacity && (
                            <span className="block whitespace-nowrap font-semibold">{r.capacity - r.occupants.length} free</span>
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
      <div className="mt-4 border border-border bg-surface p-3 sm:p-5">
        <BoardKey types={types} />
      </div>
    </>
  );
}
