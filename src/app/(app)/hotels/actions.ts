"use server";

import { mutate } from "@/lib/mutations";

import { cookies } from "next/headers";
import { and, eq, ne } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireStaff } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { str } from "@/lib/format";
import { HOTEL_COOKIE, isOwner } from "@/lib/hotel";
import { newRoomToken } from "@/lib/room-qr";
import type { ActionState } from "@/lib/action-state";

function readHotel(fd: FormData) {
  const name = str(fd.get("name"));
  if (!name) return { error: "Give the hotel a name." } as const;
  if (name.length > 100) return { error: "Keep the name under 100 characters." } as const;
  return { value: { name, address: str(fd.get("address")), phone: str(fd.get("phone")) } } as const;
}

/** The owner adds a hotel, optionally with its rooms numbered by floor (101, 102 … 201 …). */
export async function createHotel(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(["admin"]);
    if (!isOwner(user)) return { error: "Only an admin for every hotel can add hotels." };
    const parsed = readHotel(fd);
    if ("error" in parsed) return { error: parsed.error };
    const floors = Number(str(fd.get("floors")) ?? 0);
    const perFloor = Number(str(fd.get("roomsPerFloor")) ?? 0);
    if (!Number.isInteger(floors) || floors < 0 || floors > 60) return { error: "Floors must be a whole number from 0 to 60." };
    if (!Number.isInteger(perFloor) || perFloor < 0 || perFloor > 99) return { error: "Rooms per floor must be a whole number from 0 to 99." };
    if ((floors === 0) !== (perFloor === 0)) return { error: "Fill in both floors and rooms per floor, or leave both blank." };
    const db = await getDb();
    if (await db.query.properties.findFirst({ where: eq(schema.properties.name, parsed.value.name) }))
      return { error: `There's already a hotel called ${parsed.value.name}.` };
    const [hotel] = await db.insert(schema.properties).values(parsed.value).returning();
    const rooms = [];
    for (let floor = 1; floor <= floors; floor++)
      for (let n = 1; n <= perFloor; n++) rooms.push({ propertyId: hotel.id, number: `${floor}${String(n).padStart(2, "0")}`, floor, qrToken: newRoomToken() });
    if (rooms.length) await db.insert(schema.rooms).values(rooms);
    await audit(user.id, "create", "property", hotel.id, { ...parsed.value, rooms: rooms.length });
    // Switch to the new hotel so its rooms and settings are what the owner sees next.
    (await cookies()).set(HOTEL_COOKIE, hotel.id, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
    return { ok: `${hotel.name} added${rooms.length ? ` with ${rooms.length} rooms` : ""}. You're now looking at it.` };
  });
}

export async function updateHotel(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(["admin"]);
    if (!isOwner(user)) return { error: "Only an admin for every hotel can change hotels." };
    const parsed = readHotel(fd);
    if ("error" in parsed) return { error: parsed.error };
    const db = await getDb();
    if (await db.query.properties.findFirst({ where: and(eq(schema.properties.name, parsed.value.name), ne(schema.properties.id, id)) }))
      return { error: `There's already a hotel called ${parsed.value.name}.` };
    const [updated] = await db.update(schema.properties).set(parsed.value).where(eq(schema.properties.id, id)).returning();
    if (!updated) return { error: "Hotel not found." };
    await audit(user.id, "update", "property", id, parsed.value);
    return { ok: "Saved." };
  });
}
