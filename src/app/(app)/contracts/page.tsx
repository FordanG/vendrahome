import Link from "next/link";
import { count, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN } from "@/lib/auth";
import { requireHotel } from "@/lib/hotel";
import { daysBetween, formatDate, todayISO } from "@/lib/format";
import { Badge, Empty, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";
import { CONTRACT_STATUS_LABELS, CONTRACT_STATUS_TONES } from "./status";

export default async function ContractsPage() {
  const { user, hotel } = await requireHotel(CAN.viewClients);
  const db = await getDb();
  const [contracts, roomCounts] = await Promise.all([
    db
      .select({ c: schema.contracts, clientName: schema.clients.name })
      .from(schema.contracts)
      .innerJoin(schema.clients, eq(schema.contracts.clientId, schema.clients.id))
      .where(eq(schema.contracts.propertyId, hotel.id))
      .orderBy(desc(schema.contracts.startDate)),
    db
      .select({ contractId: schema.contractRooms.contractId, n: count() })
      .from(schema.contractRooms)
      .groupBy(schema.contractRooms.contractId),
  ]);
  const roomsBy = new Map(roomCounts.map((r) => [r.contractId, r.n]));
  const today = todayISO();

  return (
    <>
      <PageHeader
        title="Contracts"
        subtitle={`Leases with companies at ${hotel.name}: which rooms, for how long, and the rent.`}
        actions={CAN.manageContracts.includes(user.role) && <LinkButton href="/contracts/new">New contract</LinkButton>}
      />
      {contracts.length === 0 ? (
        <Empty>No contracts yet. Add one when a company leases rooms.</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Contract</Th>
              <Th>Company</Th>
              <Th>Rooms</Th>
              <Th>Dates</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {contracts.map(({ c, clientName }) => {
              const left = daysBetween(today, c.endDate);
              return (
                <tr key={c.id} className="hover:bg-background">
                  <Td primary>
                    <Link className="font-medium hover:underline" href={`/contracts/${c.id}`}>
                      {c.reference}
                    </Link>
                  </Td>
                  <Td label="Company">{clientName}</Td>
                  <Td label="Rooms">{roomsBy.get(c.id) ?? 0}</Td>
                  <Td label="Dates" wide>
                    {formatDate(c.startDate)} to {formatDate(c.endDate)}
                    {c.status === "active" && left >= 0 && left <= 90 && (
                      <span className="ml-2">
                        <Badge tone="amber">Ends in {left} days</Badge>
                      </span>
                    )}
                  </Td>
                  <Td label="Status">
                    <Badge tone={CONTRACT_STATUS_TONES[c.status]}>{CONTRACT_STATUS_LABELS[c.status]}</Badge>
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
