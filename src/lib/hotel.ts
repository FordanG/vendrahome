import "server-only";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";
import { asc, eq, sql, type AnyColumn } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Property, Staff, StaffRole } from "@/db/schema";
import { requireStaff } from "@/lib/auth";

// Several hotels, one business. Hotel staff work at one hotel; an admin with no
// hotel is the owner and switches between all of them. Pages list the hotel being
// looked at; actions check that what they touch is in a hotel the login can reach.

export const HOTEL_COOKIE = "hotel";

/** The owner: an admin not tied to one hotel. Only the owner adds hotels and sees them all. */
export const isOwner = (user: Pick<Staff, "role" | "propertyId">) => user.role === "admin" && !user.propertyId;

export async function hotelsFor(user: Pick<Staff, "role" | "propertyId">): Promise<Property[]> {
  const db = await getDb();
  // Oldest first, so the first hotel stays the default one.
  if (isOwner(user)) return db.select().from(schema.properties).orderBy(asc(schema.properties.createdAt), asc(schema.properties.name));
  if (!user.propertyId) return [];
  return db.select().from(schema.properties).where(eq(schema.properties.id, user.propertyId));
}

const loadHotels = cache(async (userId: string, role: StaffRole, propertyId: string | null) => hotelsFor({ role, propertyId }));

/**
 * Use in hotel staff pages and actions instead of requireStaff when the page
 * lists one hotel's things. Returns the login, the hotel being looked at, and
 * every hotel the login can reach.
 */
export async function requireHotel(roles?: StaffRole[]) {
  const user = await requireStaff(roles);
  const hotels = await loadHotels(user.id, user.role, user.propertyId);
  if (hotels.length === 0) notFound();
  const chosen = (await cookies()).get(HOTEL_COOKIE)?.value;
  const hotel = hotels.find((h) => h.id === chosen) ?? hotels[0];
  return { user, hotel, hotels };
}

/** Whether this login may see or change something in that hotel. */
export function canUseHotel(user: Pick<Staff, "role" | "propertyId">, propertyId: string | null | undefined) {
  return !!propertyId && (isOwner(user) || user.propertyId === propertyId);
}

/** The room, if it is in a hotel this login can reach. */
export async function roomInReach(user: Pick<Staff, "role" | "propertyId">, roomId: string | null | undefined) {
  if (!roomId) return null;
  const db = await getDb();
  const room = await db.query.rooms.findFirst({ where: eq(schema.rooms.id, roomId) });
  return room && canUseHotel(user, room.propertyId) ? room : null;
}

/** The contract, if it is at a hotel this login can reach. */
export async function contractInReach(user: Pick<Staff, "role" | "propertyId">, contractId: string | null | undefined) {
  if (!contractId) return null;
  const db = await getDb();
  const contract = await db.query.contracts.findFirst({ where: eq(schema.contracts.id, contractId) });
  return contract && canUseHotel(user, contract.propertyId) ? contract : null;
}

/** The tenant, if they stay (or last stayed) at a hotel this login can reach, or haven't been placed yet. */
export async function occupantInReach(user: Pick<Staff, "role" | "propertyId">, occupantId: string | null | undefined) {
  if (!occupantId) return null;
  const db = await getDb();
  const occupant = await db.query.occupants.findFirst({ where: eq(schema.occupants.id, occupantId) });
  if (!occupant) return null;
  return isOwner(user) || !occupant.propertyId || occupant.propertyId === user.propertyId ? occupant : null;
}

// Filters for queries: the column points at a room, shared space or contract in this hotel.
export const inHotelRooms = (column: AnyColumn, hotelId: string) =>
  sql`${column} in (select "id" from "rooms" where "property_id" = ${hotelId})`;
export const inHotelAreas = (column: AnyColumn, hotelId: string) =>
  sql`${column} in (select "id" from "areas" where "property_id" = ${hotelId})`;
export const inHotelContracts = (column: AnyColumn, hotelId: string) =>
  sql`${column} in (select "id" from "contracts" where "property_id" = ${hotelId})`;

/** Whether a request's room or shared space is in a hotel this login can reach. */
export async function requestInReach(user: Pick<Staff, "role" | "propertyId">, request: { roomId: string | null; areaId: string | null }) {
  if (request.roomId) return !!(await roomInReach(user, request.roomId));
  if (!request.areaId) return isOwner(user);
  const db = await getDb();
  const area = await db.query.areas.findFirst({ where: eq(schema.areas.id, request.areaId) });
  return !!area && canUseHotel(user, area.propertyId);
}

/** For bulk updates: limits rows to rooms in hotels this login can reach (no limit for the owner). */
export const reachRooms = (user: Pick<Staff, "role" | "propertyId">, column: AnyColumn) =>
  isOwner(user) ? undefined : inHotelRooms(column, user.propertyId ?? "00000000-0000-0000-0000-000000000000");
