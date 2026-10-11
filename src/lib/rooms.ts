import "server-only";
import { and, asc, eq, gt, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { inHotelRooms } from "./hotel";

import type { RoomStatus } from "./room-status";

export { STATUS_LABELS, type RoomStatus } from "./room-status";

export type BoardOccupant = {
  assignmentId: string;
  occupantId: string;
  fullName: string;
  employeeId: string | null;
  slot: string | null;
  checkIn: string;
  expectedCheckOut: string | null;
};

export type BoardRoom = {
  id: string;
  number: string;
  floor: number;
  capacity: number;
  condition: "ready" | "needs_work" | "not_available";
  typeName: string | null;
  status: RoomStatus;
  contract: { id: string; reference: string; clientName: string; endDate: string } | null;
  occupants: BoardOccupant[];
  upcoming: BoardOccupant[];
  /** Open problem reports and maintenance requests for this room. */
  openRequests: { id: string; kind: "issue" | "maintenance"; urgent: boolean }[];
  /** Marked Needs work by staff, or has open requests. Independent of who lives there. */
  needsWork: boolean;
  assignableBeds: number;
};

/** Every room of one hotel with its derived status as of `today`. */
export async function getRoomBoard(today: string, hotelId: string): Promise<BoardRoom[]> {
  const db = await getDb();

  const [rooms, contracted, assignments, requests] = await Promise.all([
    db
      .select({ room: schema.rooms, typeName: schema.roomTypes.name })
      .from(schema.rooms)
      .leftJoin(schema.roomTypes, eq(schema.rooms.roomTypeId, schema.roomTypes.id))
      .where(eq(schema.rooms.propertyId, hotelId))
      .orderBy(asc(schema.rooms.floor), asc(schema.rooms.number)),
    db
      .select({
        roomId: schema.contractRooms.roomId,
        id: schema.contracts.id,
        reference: schema.contracts.reference,
        endDate: schema.contracts.endDate,
        clientName: schema.clients.name,
      })
      .from(schema.contractRooms)
      .innerJoin(schema.contracts, eq(schema.contractRooms.contractId, schema.contracts.id))
      .innerJoin(schema.clients, eq(schema.contracts.clientId, schema.clients.id))
      .where(
        and(
          eq(schema.contracts.status, "active"),
          eq(schema.contracts.propertyId, hotelId),
          lte(schema.contracts.startDate, today),
          gte(schema.contracts.endDate, today),
        ),
      ),
    db
      .select({
        assignmentId: schema.roomAssignments.id,
        roomId: schema.roomAssignments.roomId,
        occupantId: schema.occupants.id,
        fullName: schema.occupants.fullName,
        employeeId: schema.occupants.employeeId,
        slot: schema.roomAssignments.slot,
        checkIn: schema.roomAssignments.checkIn,
        expectedCheckOut: schema.roomAssignments.expectedCheckOut,
      })
      .from(schema.roomAssignments)
      .innerJoin(schema.occupants, eq(schema.roomAssignments.occupantId, schema.occupants.id))
      .where(and(inHotelRooms(schema.roomAssignments.roomId, hotelId), or(isNull(schema.roomAssignments.actualCheckOut), gt(schema.roomAssignments.actualCheckOut, today))))
      .orderBy(asc(schema.roomAssignments.slot), asc(schema.occupants.fullName)),
    db
      .select({
        id: schema.tenantRequests.id,
        roomId: schema.tenantRequests.roomId,
        kind: schema.tenantRequests.kind,
        urgent: schema.tenantRequests.urgent,
      })
      .from(schema.tenantRequests)
      .where(
        and(
          inArray(schema.tenantRequests.kind, ["issue", "maintenance"]),
          inArray(schema.tenantRequests.status, ["pending", "approved"]),
          eq(schema.tenantRequests.awaitingCompany, false),
          inHotelRooms(schema.tenantRequests.roomId, hotelId),
        ),
      ),
  ]);

  const contractByRoom = new Map(contracted.map((c) => [c.roomId, c]));

  return rooms.map(({ room, typeName }) => {
    const mine = assignments.filter((a) => a.roomId === room.id);
    const occupants = mine.filter((a) => a.checkIn <= today);
    const upcoming = mine.filter((a) => a.checkIn > today);
    const c = contractByRoom.get(room.id);
    const openRequests = requests
      .filter((r) => r.roomId === room.id)
      .map((r) => ({ id: r.id, kind: r.kind as "issue" | "maintenance", urgent: r.urgent }));
    let status: RoomStatus;
    if (occupants.length > 0) status = "occupied";
    else if (room.condition !== "ready") status = room.condition;
    else if (c) status = "contracted_empty";
    else status = "vacant";
    return {
      id: room.id,
      number: room.number,
      floor: room.floor,
      capacity: room.capacity,
      condition: room.condition,
      typeName,
      status,
      contract: c ? { id: c.id, reference: c.reference, clientName: c.clientName, endDate: c.endDate } : null,
      occupants,
      upcoming,
      assignableBeds: room.condition === "ready" && c ? Math.max(0, room.capacity - mine.length) : 0,
      openRequests,
      needsWork: room.condition === "needs_work" || openRequests.length > 0,
    };
  });
}
