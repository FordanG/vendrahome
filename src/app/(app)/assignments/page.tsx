import Link from "next/link";
import { and, asc, eq, isNull, lte } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN, requireStaff } from "@/lib/auth";
import { getRoomBoard } from "@/lib/rooms";
import { STATUS_LABELS, STATUS_TONES } from "@/lib/room-status";
import { addDaysISO, bedsFree, formatDate, todayISO } from "@/lib/format";
import { AutoSubmitSelect } from "@/components/auto-submit";
import { FloorJump, Row, RowLine, RowList, RoomPlate } from "@/components/list";
import { Badge, Button, Card, Empty, Input, LinkButton, PageHeader, SectionTitle, Table, Td, Th } from "@/components/ui";

export default async function AssignmentsPage({ searchParams }: PageProps<"/assignments">) {
  await requireStaff(CAN.manageOccupants);
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().toLowerCase() : "";
  const show = sp.show === "free" || sp.show === "occupied" ? sp.show : "all";
  const today = todayISO();
  const horizon = addDaysISO(today, 14);
  const db = await getDb();

  const [board, unassigned, checkOuts] = await Promise.all([
    getRoomBoard(today),
    db
      .select({ id: schema.occupants.id, fullName: schema.occupants.fullName, employeeId: schema.occupants.employeeId })
      .from(schema.occupants)
      .leftJoin(
        schema.roomAssignments,
        and(eq(schema.roomAssignments.occupantId, schema.occupants.id), isNull(schema.roomAssignments.actualCheckOut)),
      )
      .where(and(eq(schema.occupants.status, "active"), isNull(schema.roomAssignments.id)))
      .orderBy(asc(schema.occupants.fullName)),
    db
      .select({
        occupantId: schema.occupants.id,
        fullName: schema.occupants.fullName,
        roomNumber: schema.rooms.number,
        expectedCheckOut: schema.roomAssignments.expectedCheckOut,
      })
      .from(schema.roomAssignments)
      .innerJoin(schema.occupants, eq(schema.roomAssignments.occupantId, schema.occupants.id))
      .innerJoin(schema.rooms, eq(schema.roomAssignments.roomId, schema.rooms.id))
      .where(
        and(
          isNull(schema.roomAssignments.actualCheckOut),
          lte(schema.roomAssignments.expectedCheckOut, horizon),
        ),
      )
      .orderBy(asc(schema.roomAssignments.expectedCheckOut)),
  ]);
  const checkIns = board
    .flatMap((r) => r.upcoming.map((o) => ({ ...o, roomNumber: r.number })))
    .filter((o) => o.checkIn <= horizon)
    .sort((a, b) => a.checkIn.localeCompare(b.checkIn));

  const rooms = board.filter((r) => {
    const free = r.capacity - r.occupants.length - r.upcoming.length;
    if (show === "free" && (free <= 0 || r.status === "not_available")) return false;
    if (show === "occupied" && r.occupants.length === 0) return false;
    if (!q) return true;
    return (
      r.number.toLowerCase().includes(q) ||
      [...r.occupants, ...r.upcoming].some(
        (o) => o.fullName.toLowerCase().includes(q) || o.employeeId?.toLowerCase().includes(q),
      )
    );
  });
  const floors = [...new Set(rooms.map((r) => r.floor))];
  const people = board.reduce((n, r) => n + r.occupants.length, 0);
  const capacity = board.filter((r) => r.status !== "not_available").reduce((n, r) => n + r.capacity, 0);

  return (
    <>
      <PageHeader
        title="Room assignments"
        subtitle={`${people} of ${capacity} beds taken. ${
          unassigned.length === 0
            ? "Every tenant has a room."
            : `${unassigned.length} ${unassigned.length === 1 ? "tenant has" : "tenants have"} no room yet.`
        }`}
        actions={
          <>
            <LinkButton variant="secondary" href="/assignments/import">
              Import from spreadsheet
            </LinkButton>
            <LinkButton href="/assignments/new">Give a tenant a room</LinkButton>
          </>
        }
      />

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card>
          <SectionTitle>Moving in, next 14 days</SectionTitle>
          {checkIns.length === 0 ? (
            <p className="text-sm text-muted">No one is moving in.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {checkIns.map((o) => (
                <li key={o.assignmentId}>
                  <Link className="underline" href={`/occupants/${o.occupantId}`}>
                    {o.fullName}
                  </Link>{" "}
                  moves into room {o.roomNumber} on {formatDate(o.checkIn)}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <SectionTitle>Moving out, next 14 days</SectionTitle>
          {checkOuts.length === 0 ? (
            <p className="text-sm text-muted">No one is expected to move out.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {checkOuts.map((o) => (
                <li key={o.occupantId} className={o.expectedCheckOut! < today ? "text-attention" : ""}>
                  <Link className="underline" href={`/occupants/${o.occupantId}`}>
                    {o.fullName}
                  </Link>{" "}
                  in room {o.roomNumber}
                  {o.expectedCheckOut! < today
                    ? `, was expected to move out on ${formatDate(o.expectedCheckOut)} and is still here`
                    : `, on ${formatDate(o.expectedCheckOut)}`}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <SectionTitle>Tenants with no room</SectionTitle>
          {unassigned.length === 0 ? (
            <p className="text-sm text-muted">Every tenant has a room.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {unassigned.slice(0, 12).map((o) => (
                <li key={o.id}>
                  <Link className="underline" href={`/occupants/${o.id}`}>
                    {o.fullName}
                  </Link>
                  {o.employeeId && <span className="text-muted"> (employee ID {o.employeeId})</span>}
                </li>
              ))}
              {unassigned.length > 12 && <li className="text-muted">and {unassigned.length - 12} more</li>}
            </ul>
          )}
        </Card>
      </div>

      <form className="mb-4 space-y-2 sm:flex sm:flex-wrap sm:items-end sm:gap-3 sm:space-y-0">
        <div className="flex gap-2 sm:contents">
          <Input
            name="q"
            defaultValue={q}
            placeholder="Room, name or employee ID"
            className="min-w-0 flex-1 sm:w-64 sm:flex-none"
            aria-label="Search rooms"
            type="search"
          />
          <Button variant="secondary">Search</Button>
        </div>
        <AutoSubmitSelect name="show" defaultValue={show} className="sm:w-48" aria-label="Show">
          <option value="all">All rooms</option>
          <option value="free">Rooms with free beds</option>
          <option value="occupied">Rooms with tenants</option>
        </AutoSubmitSelect>
      </form>

      {rooms.length === 0 ? (
        <Empty>No rooms match your search.</Empty>
      ) : (
        <>
          <FloorJump floors={floors} />
          <div className="space-y-5 sm:hidden">
            {floors.map((f) => (
              <section key={f} id={`floor-${f}`} className="floor-section" aria-label={`Floor ${f}`}>
                <h2 className="mb-2 text-sm font-semibold text-muted">Floor {f}</h2>
                <RowList>
                  {rooms
                    .filter((r) => r.floor === f)
                    .map((r) => {
                      const free = r.capacity - r.occupants.length - r.upcoming.length;
                      const names = r.occupants.map((o) => o.fullName);
                      return (
                        <Row
                          key={r.id}
                          href={`/rooms/${r.id}`}
                          plate={<RoomPlate number={r.number} status={r.status} />}
                          title={names.length > 0 ? names.join(", ") : "No one lives here"}
                          action={
                            free > 0 &&
                            r.status !== "not_available" && (
                              <LinkButton variant="secondary" href={`/assignments/new?room=${r.id}`} className="px-3">
                                Give a room
                              </LinkButton>
                            )
                          }
                        >
                          {r.upcoming.map((o) => (
                            <RowLine key={o.assignmentId}>
                              {o.fullName} moves in {formatDate(o.checkIn)}
                            </RowLine>
                          ))}
                          <RowLine>{r.status === "not_available" ? STATUS_LABELS[r.status] : bedsFree(free)}</RowLine>
                        </Row>
                      );
                    })}
                </RowList>
              </section>
            ))}
          </div>

          <div className="hidden sm:block">
            <Table>
              <thead>
                <tr>
                  <Th>Room</Th>
                  <Th>Status</Th>
                  <Th>Tenants</Th>
                  <Th>Beds</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {rooms.map((r) => {
                  const free = r.capacity - r.occupants.length - r.upcoming.length;
                  return (
                    <tr key={r.id}>
                      <Td primary>
                        <Link className="font-medium hover:underline" href={`/rooms/${r.id}`}>
                          {r.number}
                        </Link>
                        <span className="block text-xs text-muted">Floor {r.floor}</span>
                      </Td>
                      <Td label="Status">
                        <Badge tone={STATUS_TONES[r.status]}>{STATUS_LABELS[r.status]}</Badge>
                      </Td>
                      <Td label="Tenants" wide className="max-sm:order-1">
                        {r.occupants.length === 0 && r.upcoming.length === 0 && <span className="text-muted">No one</span>}
                        {r.occupants.map((o) => (
                          <div key={o.assignmentId}>
                            <Link className="underline" href={`/occupants/${o.occupantId}`}>
                              {o.fullName}
                            </Link>
                            <span className="text-xs text-muted">
                              {o.slot && `, ${o.slot}`}, since {formatDate(o.checkIn)}
                            </span>
                          </div>
                        ))}
                        {r.upcoming.map((o) => (
                          <div key={o.assignmentId} className="text-muted">
                            {o.fullName}, moves in {formatDate(o.checkIn)}
                          </div>
                        ))}
                      </Td>
                      <Td label="Beds" className="whitespace-nowrap">{bedsFree(free)}</Td>
                      <Td className="text-right max-sm:order-2">
                        {free > 0 && r.status !== "not_available" && (
                          <Link
                            className="inline-flex min-h-11 items-center text-sm text-accent underline sm:min-h-0"
                            href={`/assignments/new?room=${r.id}`}
                          >
                            Give a room
                          </Link>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
        </>
      )}
    </>
  );
}
