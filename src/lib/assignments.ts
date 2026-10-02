import "server-only";
import { and, eq, gte, isNull, lte, ne } from "drizzle-orm";
import { getDb, schema } from "@/db";

type AssignInput = {
  roomId: string;
  slot: string | null;
  checkIn: string;
  exceptAssignmentId?: string;
};

/**
 * Checks a room can take one more person: capacity, slot not taken.
 * Returns an error message, or the active contract covering the room on check-in.
 */
export async function checkRoomAvailable({
  roomId,
  slot,
  checkIn,
  exceptAssignmentId,
}: AssignInput): Promise<{ error: string } | { contractId: string | null; roomNumber: string }> {
  const db = await getDb();
  const room = await db.query.rooms.findFirst({ where: eq(schema.rooms.id, roomId) });
  if (!room) return { error: "Room not found." };
  if (room.condition === "not_available") return { error: `Room ${room.number} is out of service.` };

  const open = await db
    .select({ id: schema.roomAssignments.id, slot: schema.roomAssignments.slot })
    .from(schema.roomAssignments)
    .where(
      and(
        eq(schema.roomAssignments.roomId, roomId),
        isNull(schema.roomAssignments.actualCheckOut),
        exceptAssignmentId ? ne(schema.roomAssignments.id, exceptAssignmentId) : undefined,
      ),
    );
  if (open.length >= room.capacity) {
    return { error: `Room ${room.number} is full (${open.length} of ${room.capacity} beds taken). Move someone out, or add beds to the room.` };
  }
  if (slot && open.some((o) => o.slot?.toLowerCase() === slot.toLowerCase())) {
    return { error: `${slot} in room ${room.number} is already taken.` };
  }

  const [contract] = await db
    .select({ id: schema.contracts.id })
    .from(schema.contractRooms)
    .innerJoin(schema.contracts, eq(schema.contractRooms.contractId, schema.contracts.id))
    .where(
      and(
        eq(schema.contractRooms.roomId, roomId),
        eq(schema.contracts.status, "active"),
        lte(schema.contracts.startDate, checkIn),
        gte(schema.contracts.endDate, checkIn),
      ),
    )
    .limit(1);

  return { contractId: contract?.id ?? null, roomNumber: room.number };
}

export async function openAssignmentFor(occupantId: string) {
  const db = await getDb();
  return db.query.roomAssignments.findFirst({
    where: and(eq(schema.roomAssignments.occupantId, occupantId), isNull(schema.roomAssignments.actualCheckOut)),
  });
}

export type RoomOption = { id: string; number: string; floor: number; capacity: number; taken: number };

/** Rooms with how many people are staying now, for room dropdowns. */
export async function getRoomOptions(): Promise<RoomOption[]> {
  const db = await getDb();
  const [rooms, open] = await Promise.all([
    db.query.rooms.findMany({ orderBy: (r, { asc }) => [asc(r.floor), asc(r.number)] }),
    db
      .select({ roomId: schema.roomAssignments.roomId })
      .from(schema.roomAssignments)
      .where(isNull(schema.roomAssignments.actualCheckOut)),
  ]);
  const taken = new Map<string, number>();
  for (const o of open) taken.set(o.roomId, (taken.get(o.roomId) ?? 0) + 1);
  return rooms
    .filter((r) => r.condition !== "not_available")
    .map((r) => ({ id: r.id, number: r.number, floor: r.floor, capacity: r.capacity, taken: taken.get(r.id) ?? 0 }));
}
