import Link from "next/link";
import { and, asc, eq, isNull, lte } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb, schema } from "@/db";
import { CAN, requireStaff } from "@/lib/auth";
import { getRoomBoard } from "@/lib/rooms";
import { STATUS_LABELS, STATUS_TONES } from "@/lib/room-status";
import { addDaysISO, bedsFree, formatDate, todayISO } from "@/lib/format";
import { AutoSubmitSelect } from "@/components/auto-submit";
import { FloorJump, Row, RowLine, RowList, RoomPlate } from "@/components/list";
import { Badge, Button, Card, Empty, Field, Input, LinkButton, PageHeader, SectionTitle, Table, Td, Th } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { STAY_REQUEST_LABELS } from "@/lib/company";
import { confirmStayRequest, declineStayRequest } from "./actions";

export default async function AssignmentsPage({ searchParams }: PageProps<"/assignments">) {
  await requireStaff(CAN.manageOccupants);
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().toLowerCase() : "";
  const show = sp.show === "free" || sp.show === "occupied" ? sp.show : "all";
  const today = todayISO();
  const horizon = addDaysISO(today, 14);
  const db = await getDb();

  const asker = alias(schema.staff, "asker");
  const [board, unassigned, checkOuts, asks] = await Promise.all([
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
    db
      .select({ s: schema.stayRequests, fullName: schema.occupants.fullName, company: schema.clients.name, roomNumber: schema.rooms.number, asker: asker.name })
      .from(schema.stayRequests)
      .innerJoin(schema.occupants, eq(schema.stayRequests.occupantId, schema.occupants.id))
      .innerJoin(schema.clients, eq(schema.stayRequests.clientId, schema.clients.id))
      .leftJoin(schema.rooms, eq(schema.stayRequests.roomId, schema.rooms.id))
      .leftJoin(asker, eq(schema.stayRequests.requestedBy, asker.id))
      .where(eq(schema.stayRequests.status, "pending"))
      .orderBy(asc(schema.stayRequests.date), asc(schema.stayRequests.createdAt)),
  ]);
  const checkIns = board
    .flatMap((r) => r.upcoming.map((o) => ({ ...o, roomNumber: r.number })))
    .filter((o) => o.checkIn <= horizon)
    .sort((a, b) => a.checkIn.localeCompare(b.checkIn));

  const rooms = board.filter((r) => {
    const free = r.assignableBeds;
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

      {asks.length > 0 && (
        <section className="mb-6">
          <SectionTitle>Asked by companies</SectionTitle>
          <div className="grid gap-3 lg:grid-cols-2">
            {asks.map(({ s, fullName, company, roomNumber, asker }) => (
              <Card key={s.id} className="border-brand p-3 sm:p-4">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge tone="amber">{STAY_REQUEST_LABELS[s.kind]}</Badge>
                  <Link className="font-semibold underline" href={`/occupants/${s.occupantId}`}>
                    {fullName}
                  </Link>
                  <span className="text-muted">{company}</span>
                </div>
                <p className="mt-1 text-sm">
                  {s.kind === "move_in" ? `Into room ${roomNumber ?? "?"}${s.slot ? `, ${s.slot}` : ""} on ${formatDate(s.date)}` : `Out of room ${roomNumber ?? "?"} on ${formatDate(s.date)}`}
                  {s.expectedCheckOut && `, until ${formatDate(s.expectedCheckOut)}`}
                </p>
                {s.note && <p className="mt-1 text-sm text-muted">&ldquo;{s.note}&rdquo;</p>}
                {asker && <p className="mt-1 text-xs text-muted">Asked by {asker}</p>}
                <ActionForm
                  action={confirmStayRequest.bind(null, s.id)}
                  submitLabel={s.kind === "move_in" ? "Move them in" : "Move them out"}
                  pendingLabel="Saving…"
                  className="mt-3 space-y-3"
                >
                  {s.kind === "move_in" ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Move-in date">
                        <Input name="checkIn" type="date" defaultValue={s.date} required />
                      </Field>
                      <Field label="Bed" hint="Optional">
                        <Input name="slot" defaultValue={s.slot ?? ""} />
                      </Field>
                      <Field label="Keys and cards issued" hint="e.g. 1 room key, 1 key card #0412">
                        <Input name="keysIssued" />
                      </Field>
                    </div>
                  ) : (
                    <Field label="Moved out on" hint="Confirm on the day they leave">
                      <Input name="date" type="date" defaultValue={s.date < today ? s.date : today} max={today} required />
                    </Field>
                  )}
                </ActionForm>
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm text-muted underline underline-offset-2">Decline</summary>
                  <ActionForm action={declineStayRequest.bind(null, s.id)} submitLabel="Decline" submitVariant="danger" className="mt-2 space-y-3">
                    <Field label="Why" hint="The company sees this">
                      <Input name="response" required maxLength={1000} />
                    </Field>
                  </ActionForm>
                </details>
              </Card>
            ))}
          </div>
        </section>
      )}

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
          <option value="free">Rooms with assignable beds</option>
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
                      const free = r.assignableBeds;
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
                  const free = r.assignableBeds;
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
