import "server-only";
import { and, eq, gte, isNull, lte, ne, or, gt } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { addDaysISO, todayISO } from "./format";

type AssignInput = {
  roomId: string;
  slot: string | null;
  checkIn: string;
  clientId: string | null;
  occupantId?: string;
  expectedCheckOut?: string | null;
  actualCheckOut?: string | null;
  exceptAssignmentId?: string;
  historicalContractId?: string | null;
};

/** Stays occupy [check-in, actual checkout). Expected departure is only a forecast.
 * Future arrivals reserve capacity until staff actually check them out.
 * Call within withTransaction whenever the check is followed by a write.
 */
export async function checkRoomAvailable(input: AssignInput): Promise<
  { error: string } | { contractId: string; contractEnd: string; roomNumber: string }
> {
  const { roomId, slot, checkIn, clientId, occupantId, expectedCheckOut, actualCheckOut, exceptAssignmentId } = input;
  const db = await getDb();
  if (!clientId) return { error: "Choose the tenant's company before assigning a room." };
  const room = await db.query.rooms.findFirst({ where: eq(schema.rooms.id, roomId) });
  if (!room) return { error: "Room not found." };
  if (!actualCheckOut && room.condition !== "ready")
    return { error: `Room ${room.number} is not ready. Complete cleaning or repairs and mark it Ready first.` };

  const contracts = await db.select({ id: schema.contracts.id, endDate: schema.contracts.endDate })
    .from(schema.contractRooms)
    .innerJoin(schema.contracts, eq(schema.contractRooms.contractId, schema.contracts.id))
    .where(and(
      eq(schema.contractRooms.roomId, roomId), eq(schema.contracts.clientId, clientId),
      input.historicalContractId ? eq(schema.contracts.id, input.historicalContractId) : eq(schema.contracts.status, "active"),
      lte(schema.contracts.startDate, checkIn), gte(schema.contracts.endDate, checkIn),
    ));
  if (contracts.length !== 1) return { error: `Room ${room.number} needs one active contract for this tenant's company covering the move-in date.` };
  const contract = contracts[0];
  if (expectedCheckOut && expectedCheckOut > addDaysISO(contract.endDate, 1))
    return { error: "Expected move-out is beyond this contract. Set a date within its term; renew the contract before extending the stay." };

  const overlaps = and(
    or(isNull(schema.roomAssignments.actualCheckOut), gt(schema.roomAssignments.actualCheckOut, checkIn)),
    actualCheckOut ? lte(schema.roomAssignments.checkIn, actualCheckOut) : undefined,
    exceptAssignmentId ? ne(schema.roomAssignments.id, exceptAssignmentId) : undefined,
  );
  const stays = await db.select().from(schema.roomAssignments).where(and(
    or(eq(schema.roomAssignments.roomId, roomId), occupantId ? eq(schema.roomAssignments.occupantId, occupantId) : undefined), overlaps,
  ));
  const end = actualCheckOut ?? "9999-12-31";
  const relevant = stays.filter(s => s.checkIn < end && (!s.actualCheckOut || s.actualCheckOut > checkIn) && (!s.actualCheckOut || s.actualCheckOut > s.checkIn));
  if (occupantId && relevant.some(s => s.occupantId === occupantId))
    return { error: "This tenant already has a stay overlapping these dates. Use Move to another room." };
  const inRoom = relevant.filter(s => s.roomId === roomId);
  if (slot && inRoom.some(s => s.slot?.trim().toLowerCase() === slot.trim().toLowerCase()))
    return { error: `${slot} in room ${room.number} is already taken during this stay.` };
  // Count the peak overlap, not the sum of all historical occupants.
  const events = inRoom.flatMap(s => [
    { date: s.checkIn < checkIn ? checkIn : s.checkIn, delta: 1 },
    { date: s.actualCheckOut ?? "9999-12-31", delta: -1 },
  ]).sort((a,b) => a.date.localeCompare(b.date) || a.delta - b.delta);
  let taken = 0;
  for (const e of events) {
    if (e.date >= end) break;
    taken += e.delta;
    if (taken >= room.capacity) return { error: `Room ${room.number} is full during this stay. Confirm departures before assigning another tenant.` };
  }
  return { contractId: contract.id, contractEnd: contract.endDate, roomNumber: room.number };
}

export async function openAssignmentFor(occupantId: string) {
  const db = await getDb();
  return db.query.roomAssignments.findFirst({
    where: and(eq(schema.roomAssignments.occupantId, occupantId), or(isNull(schema.roomAssignments.actualCheckOut), gt(schema.roomAssignments.actualCheckOut, todayISO()))),
  });
}

export type RoomOption = { id: string; number: string; floor: number; capacity: number; taken: number };

/** Capacity committed to current and future stays; forecasts do not free beds. */
export async function getRoomOptions(): Promise<RoomOption[]> {
  const db = await getDb();
  const [rooms, open] = await Promise.all([
    db.query.rooms.findMany({ orderBy: (r, { asc }) => [asc(r.floor), asc(r.number)] }),
    db.select({ roomId: schema.roomAssignments.roomId }).from(schema.roomAssignments)
      .where(or(isNull(schema.roomAssignments.actualCheckOut), gt(schema.roomAssignments.actualCheckOut, todayISO()))),
  ]);
  const taken = new Map<string, number>();
  for (const o of open) taken.set(o.roomId, (taken.get(o.roomId) ?? 0) + 1);
  return rooms.filter(r => r.condition === "ready")
    .map(r => ({ id: r.id, number: r.number, floor: r.floor, capacity: r.capacity, taken: taken.get(r.id) ?? 0 }));
}
