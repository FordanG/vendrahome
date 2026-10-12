import "server-only";
import { and, asc, eq, gte, isNull, or, gt } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { addDaysISO } from "./format";
import { inHotelRooms } from "./hotel";

// When does each room free up? Two answers matter to management:
// - free to lease: no company lease covers it and nobody lives there (a new contract can take it);
// - beds free: inside a company's lease, beds that company can still fill.
// A tenant with no move-out date is taken to leave when the lease they live under ends.

export type AvailLease = { id: string; reference: string; clientName: string; startDate: string; endDate: string };
export type AvailStay = { assignmentId: string; occupantId: string; fullName: string; checkIn: string; expectedCheckOut: string | null };

export type AvailRoom = {
  id: string;
  number: string;
  floor: number;
  capacity: number;
  condition: "ready" | "needs_work" | "not_available";
  typeName: string | null;
  /** The lease covering today, if any. */
  lease: AvailLease | null;
  /** A later lease that starts after today. */
  nextLease: AvailLease | null;
  /** Living here today, soonest move-out first. */
  tenants: (AvailStay & { leavesOn: string | null })[];
  /** Booked to move in after today. */
  booked: AvailStay[];
  /** Beds the leasing company can still fill now (after bookings). */
  bedsFree: number;
  /** For a leased room that is full: the first day a bed frees up, if anyone has a move-out date. */
  nextBedFreeOn: string | null;
  /**
   * First day the room is free to lease: today, a later date, or null when it can't be known
   * (out of service, or a tenant with no move-out date and no lease to end with).
   */
  freeFrom: string | null;
  /** Last free day, when a later lease or move-in takes the room again; null when open-ended. */
  freeUntil: string | null;
  /** Why freeFrom is null. */
  unknownBecause: "out_of_service" | "no_move_out" | null;
};

/** The day a stay ends: its move-out date, or the day after the lease it lives under ends. */
export function stayEnds(stay: Pick<AvailStay, "checkIn" | "expectedCheckOut">, leases: Pick<AvailLease, "startDate" | "endDate">[], today: string): string | null {
  if (stay.expectedCheckOut) return stay.expectedCheckOut;
  const from = stay.checkIn > today ? stay.checkIn : today;
  const lease = leases.find((l) => l.startDate <= from && l.endDate >= from);
  return lease ? addDaysISO(lease.endDate, 1) : null;
}

/**
 * First day on or after `today` with no lease and no one living in the room.
 * Moves forward past each lease and stay in the way until nothing blocks; null if a stay never ends.
 */
export function firstFreeDay(leases: Pick<AvailLease, "startDate" | "endDate">[], stays: { checkIn: string; ends: string | null }[], today: string): string | null {
  let day = today;
  for (let moved = true; moved; ) {
    moved = false;
    for (const l of leases) {
      if (l.startDate <= day && l.endDate >= day) {
        day = addDaysISO(l.endDate, 1);
        moved = true;
      }
    }
    for (const s of stays) {
      if (s.checkIn <= day && (s.ends === null || s.ends > day)) {
        if (s.ends === null) return null;
        day = s.ends;
        moved = true;
      }
    }
  }
  return day;
}

/** The day before the next lease or move-in that starts after `from`, or null if none does. */
export function lastFreeDay(leases: Pick<AvailLease, "startDate">[], stays: { checkIn: string }[], from: string): string | null {
  const starts = [...leases.map((l) => l.startDate), ...stays.map((s) => s.checkIn)].filter((d) => d > from).sort();
  return starts.length ? addDaysISO(starts[0], -1) : null;
}

/** What a room looks like on another day: its lease then and how many live there. */
export function roomOn(room: Pick<AvailRoom, "capacity" | "condition" | "lease" | "nextLease" | "tenants" | "booked">, day: string, today: string) {
  const leases = [room.lease, room.nextLease].filter((l): l is AvailLease => !!l);
  const lease = leases.find((l) => l.startDate <= day && l.endDate >= day) ?? null;
  const people = [...room.tenants, ...room.booked].filter((s) => {
    const ends = stayEnds(s, leases, today);
    return s.checkIn <= day && (ends === null || ends > day);
  }).length;
  const open = room.condition !== "not_available";
  return {
    lease,
    people,
    freeToLease: open && !lease && people === 0,
    bedsFree: open && lease ? Math.max(0, room.capacity - people) : 0,
  };
}

export async function getAvailability(today: string, hotelId: string): Promise<AvailRoom[]> {
  const db = await getDb();
  const [rooms, leases, stays] = await Promise.all([
    db
      .select({ room: schema.rooms, typeName: schema.roomTypes.name })
      .from(schema.rooms)
      .leftJoin(schema.roomTypes, eq(schema.rooms.roomTypeId, schema.roomTypes.id))
      .where(eq(schema.rooms.propertyId, hotelId))
      .orderBy(asc(schema.rooms.floor), asc(schema.rooms.number)),
    // Leases running now or starting later. Drafts aren't leases yet.
    db
      .select({
        roomId: schema.contractRooms.roomId,
        id: schema.contracts.id,
        reference: schema.contracts.reference,
        clientName: schema.clients.name,
        startDate: schema.contracts.startDate,
        endDate: schema.contracts.endDate,
      })
      .from(schema.contractRooms)
      .innerJoin(schema.contracts, eq(schema.contractRooms.contractId, schema.contracts.id))
      .innerJoin(schema.clients, eq(schema.contracts.clientId, schema.clients.id))
      .where(and(eq(schema.contracts.status, "active"), eq(schema.contracts.propertyId, hotelId), gte(schema.contracts.endDate, today)))
      .orderBy(asc(schema.contracts.startDate)),
    db
      .select({
        assignmentId: schema.roomAssignments.id,
        roomId: schema.roomAssignments.roomId,
        occupantId: schema.occupants.id,
        fullName: schema.occupants.fullName,
        checkIn: schema.roomAssignments.checkIn,
        expectedCheckOut: schema.roomAssignments.expectedCheckOut,
      })
      .from(schema.roomAssignments)
      .innerJoin(schema.occupants, eq(schema.roomAssignments.occupantId, schema.occupants.id))
      .where(and(inHotelRooms(schema.roomAssignments.roomId, hotelId), or(isNull(schema.roomAssignments.actualCheckOut), gt(schema.roomAssignments.actualCheckOut, today))))
      .orderBy(asc(schema.roomAssignments.checkIn)),
  ]);

  return rooms.map(({ room, typeName }) => {
    const mine = leases.filter((l) => l.roomId === room.id);
    const lease = mine.find((l) => l.startDate <= today) ?? null;
    const nextLease = mine.find((l) => l.startDate > today) ?? null;
    const own = stays.filter((s) => s.roomId === room.id);
    const tenants = own
      .filter((s) => s.checkIn <= today)
      .map((s) => ({ ...s, leavesOn: stayEnds(s, mine, today) }))
      .sort((a, b) => (a.leavesOn ?? "9999").localeCompare(b.leavesOn ?? "9999"));
    const booked = own.filter((s) => s.checkIn > today);
    const bedsFree = lease && room.condition === "ready" ? Math.max(0, room.capacity - tenants.length - booked.length) : 0;
    const blocked = room.condition === "not_available";
    const freeFrom = blocked ? null : firstFreeDay(mine, own.map((s) => ({ checkIn: s.checkIn, ends: stayEnds(s, mine, today) })), today);
    return {
      id: room.id,
      number: room.number,
      floor: room.floor,
      capacity: room.capacity,
      condition: room.condition,
      typeName,
      lease,
      nextLease,
      tenants,
      booked,
      bedsFree,
      // Only a tenant leaving before the lease ends frees a bed the company can use.
      nextBedFreeOn: lease && bedsFree === 0 && tenants[0]?.leavesOn && tenants[0].leavesOn <= lease.endDate ? tenants[0].leavesOn : null,
      freeFrom,
      freeUntil: freeFrom ? lastFreeDay(mine, own, freeFrom) : null,
      unknownBecause: blocked ? "out_of_service" : freeFrom === null ? "no_move_out" : null,
    };
  });
}
