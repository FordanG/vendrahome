import "server-only";
import { and, asc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { getDb, schema } from "@/db";

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
};

/** Every room with its derived status as of `today`. */
export async function getRoomBoard(today: string): Promise<BoardRoom[]> {
  const db = await getDb();

  const [rooms, contracted, assignments, requests] = await Promise.all([
    db
      .select({ room: schema.rooms, typeName: schema.roomTypes.name })
      .from(schema.rooms)
      .leftJoin(schema.roomTypes, eq(schema.rooms.roomTypeId, schema.roomTypes.id))
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
      .where(isNull(schema.roomAssignments.actualCheckOut))
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
      openRequests,
      needsWork: room.condition === "needs_work" || openRequests.length > 0,
    };
  });
}
