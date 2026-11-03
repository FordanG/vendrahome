import Link from "next/link";
import { CAN } from "@/lib/auth";
import { requireHotel } from "@/lib/hotel";
import { getRoomBoard } from "@/lib/rooms";
import { STATUS_LABELS, STATUS_TONES } from "@/lib/room-status";
import { bedsTaken, todayISO } from "@/lib/format";
import { FloorJump, Row, RowLine, RowList, RoomPlate } from "@/components/list";
import { Badge, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";

export default async function RoomsPage() {
  const { user, hotel } = await requireHotel();
  const canManage = CAN.manageRooms.includes(user.role);
  const rooms = await getRoomBoard(todayISO(), hotel.id);
  const floors = [...new Set(rooms.map((r) => r.floor))];
  // With one company leasing everything, "Leased to" on every row is just noise.
  const manyCompanies = new Set(rooms.map((r) => r.contract?.clientName).filter(Boolean)).size > 1;

  return (
    <>
      <PageHeader
        title="Rooms"
        subtitle={`${rooms.length} rooms. Open a room to see who lives there and change its details.`}
        actions={
          <>
            {CAN.printDoorCodes.includes(user.role) && (
              <LinkButton variant="secondary" href="/rooms/door-codes">
                Print door codes
              </LinkButton>
            )}
            {canManage && (
              <LinkButton variant="secondary" href="/rooms/setup">
                Room setup
              </LinkButton>
            )}
          </>
        }
      />

      <FloorJump floors={floors} />
      <div className="space-y-5 sm:hidden">
        {floors.map((f) => (
          <section key={f} id={`floor-${f}`} className="floor-section" aria-label={`Floor ${f}`}>
            <h2 className="mb-2 text-sm font-semibold text-muted">Floor {f}</h2>
            <RowList>
              {rooms
                .filter((r) => r.floor === f)
                .map((r) => (
                  <Row
                    key={r.id}
                    href={`/rooms/${r.id}`}
                    plate={<RoomPlate number={r.number} status={r.status} />}
                    title={STATUS_LABELS[r.status]}
                  >
                    <RowLine>{[r.typeName, bedsTaken(r.occupants.length, r.capacity)].filter(Boolean).join(", ")}</RowLine>
                    {manyCompanies && r.contract && <RowLine>Leased to {r.contract.clientName}</RowLine>}
                  </Row>
                ))}
            </RowList>
          </section>
        ))}
      </div>

      <div className="hidden sm:block">
        <Table>
          <thead>
            <tr>
              <Th>Room</Th>
              <Th>Floor</Th>
              <Th>Type</Th>
              <Th>People allowed</Th>
              <Th>Status</Th>
              <Th>Leased to</Th>
            </tr>
          </thead>
          <tbody>
            {rooms.map((r) => (
              <tr key={r.id} className="hover:bg-background">
                <Td primary>
                  <Link href={`/rooms/${r.id}`} className="font-medium underline-offset-2 hover:underline">
                    {r.number}
                  </Link>
                </Td>
                <Td label="Floor">{r.floor}</Td>
                <Td label="Type">{r.typeName ?? <span className="text-muted">Not set</span>}</Td>
                <Td label="People allowed">
                  {r.capacity}
                  <span className="block text-xs text-muted">{r.occupants.length} living here</span>
                </Td>
                <Td label="Status">
                  <Badge tone={STATUS_TONES[r.status]}>{STATUS_LABELS[r.status]}</Badge>
                </Td>
                <Td label="Leased to" wide>{r.contract?.clientName ?? <span className="text-muted">No one</span>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>

    </>
  );
}
