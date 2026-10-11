import Link from "next/link";
import { and, asc, eq, ilike, isNull, or, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN } from "@/lib/auth";
import { requireHotel } from "@/lib/hotel";
import { formatDate, todayISO } from "@/lib/format";
import { AutoSubmitSelect } from "@/components/auto-submit";
import { Row, RowLine, RowList, RoomPlate } from "@/components/list";
import { Badge, Button, Empty, Input, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";

export default async function OccupantsPage({ searchParams }: PageProps<"/occupants">) {
  const { hotel } = await requireHotel(CAN.manageOccupants);
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const client = typeof sp.client === "string" ? sp.client : "";
  const status = sp.status === "inactive" || sp.status === "all" ? sp.status : "active";
  const today = todayISO();

  const db = await getDb();
  const filters: (SQL | undefined)[] = [];
  if (q) {
    const like = `%${q}%`;
    filters.push(
      or(
        ilike(schema.occupants.fullName, like),
        ilike(schema.occupants.nickname, like),
        ilike(schema.occupants.employeeId, like),
        ilike(schema.occupants.mobile, like),
        ilike(schema.rooms.number, like),
      ),
    );
  }
  if (client) filters.push(eq(schema.occupants.clientId, client));
  // This hotel's tenants, plus people a company added who haven't been given a room anywhere yet.
  filters.push(or(eq(schema.occupants.propertyId, hotel.id), isNull(schema.occupants.propertyId)));
  if (status !== "all") filters.push(eq(schema.occupants.status, status));

  const [rows, clients] = await Promise.all([
    db
      .select({
        o: schema.occupants,
        clientName: schema.clients.name,
        roomId: schema.rooms.id,
        roomNumber: schema.rooms.number,
        slot: schema.roomAssignments.slot,
        checkIn: schema.roomAssignments.checkIn,
        expectedCheckOut: schema.roomAssignments.expectedCheckOut,
      })
      .from(schema.occupants)
      .leftJoin(schema.clients, eq(schema.occupants.clientId, schema.clients.id))
      .leftJoin(
        schema.roomAssignments,
        and(eq(schema.roomAssignments.occupantId, schema.occupants.id), isNull(schema.roomAssignments.actualCheckOut)),
      )
      .leftJoin(schema.rooms, eq(schema.roomAssignments.roomId, schema.rooms.id))
      .where(and(...filters))
      .orderBy(asc(schema.occupants.fullName))
      .limit(500),
    db.select({ id: schema.clients.id, name: schema.clients.name }).from(schema.clients).orderBy(asc(schema.clients.name)),
  ]);

  return (
    <>
        <PageHeader
          title="Tenants"
          subtitle={`${rows.length} ${rows.length === 1 ? "tenant" : "tenants"}${
            status === "active" ? " living here now" : status === "inactive" ? " who have moved out" : " on file"
          }`}
          actions={
            <>
              <LinkButton variant="secondary" href="/assignments/import">
                Import from spreadsheet
              </LinkButton>
              <LinkButton href="/occupants/new">Add tenant</LinkButton>
          </>
        }
      />

      <form className="mb-5 space-y-2 sm:flex sm:flex-wrap sm:items-end sm:gap-3 sm:space-y-0">
        <div className="flex gap-2 sm:contents">
          <Input
            name="q"
            defaultValue={q}
            placeholder="Name, ID, mobile or room"
            className="min-w-0 flex-1 sm:w-72 sm:flex-none"
            aria-label="Search tenants"
            type="search"
          />
          <Button variant="secondary">Search</Button>
        </div>
        <div className="flex gap-2 sm:contents">
          {(clients.length > 1 || client) && (
            <AutoSubmitSelect name="client" defaultValue={client} className="min-w-0 flex-1 sm:w-56 sm:flex-none" aria-label="Company">
              <option value="">All companies</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </AutoSubmitSelect>
          )}
          <AutoSubmitSelect name="status" defaultValue={status} className="min-w-0 flex-1 sm:w-40 sm:flex-none" aria-label="Show">
            <option value="active">Living here now</option>
            <option value="inactive">Moved out</option>
            <option value="all">Everyone</option>
          </AutoSubmitSelect>
        </div>
      </form>

      {rows.length === 0 ? (
        <Empty>No tenants match. Add tenants one by one, or import the company&apos;s list from a spreadsheet.</Empty>
      ) : (
        <>
          <RowList className="sm:hidden">
            {rows.map((r) => (
              <Row
                key={r.o.id}
                href={`/occupants/${r.o.id}`}
                plate={r.roomNumber ? <RoomPlate number={r.roomNumber} status="occupied" /> : undefined}
                title={r.o.fullName}
                badge={!r.roomNumber && (r.o.status === "active" ? <Badge tone="amber">No room</Badge> : <Badge>Moved out</Badge>)}
              >
                {/* One company is the usual case; then naming it on every row is just noise. */}
                {(r.o.position || (clients.length > 1 && r.clientName)) && (
                  <RowLine>{[r.o.position, clients.length > 1 && r.clientName].filter(Boolean).join(", ")}</RowLine>
                )}
                {r.checkIn && (
                  <RowLine>
                    {r.checkIn > today ? "Moves in" : "Moved in"} {formatDate(r.checkIn)}
                    {r.expectedCheckOut && `, expected to move out ${formatDate(r.expectedCheckOut)}`}
                  </RowLine>
                )}
              </Row>
            ))}
          </RowList>
          <div className="hidden sm:block">
            <Table>
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Employee ID</Th>
                  <Th>Company</Th>
                  <Th>Room</Th>
                  <Th>Moved in</Th>
                  <Th>Expected to move out</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.o.id} className="hover:bg-background">
                    <Td primary>
                      <Link className="font-medium hover:underline" href={`/occupants/${r.o.id}`}>
                        {r.o.fullName}
                      </Link>
                      {r.o.position && <span className="block text-xs text-muted">{r.o.position}</span>}
                    </Td>
                    <Td label="Employee ID">{r.o.employeeId ?? <span className="text-muted">Not set</span>}</Td>
                    <Td label="Company" wide className="max-sm:order-1">{r.clientName ?? <span className="text-muted">No company</span>}</Td>
                    <Td label="Room">
                      {r.roomNumber ? (
                        <Link className="underline" href={`/rooms/${r.roomId}`}>
                          Room {r.roomNumber}
                          {r.slot && `, ${r.slot}`}
                        </Link>
                      ) : r.o.status === "active" ? (
                        <Badge tone="amber">No room</Badge>
                      ) : (
                        <Badge>Moved out</Badge>
                      )}
                    </Td>
                    <Td label="Moved in">{r.checkIn ? formatDate(r.checkIn) : <span className="text-muted">No room</span>}</Td>
                    <Td label="Expected to move out">{r.expectedCheckOut ? formatDate(r.expectedCheckOut) : <span className="text-muted">Not set</span>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </>
      )}
    </>
  );
}
