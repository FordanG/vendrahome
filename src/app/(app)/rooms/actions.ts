"use server";

import { mutate } from "@/lib/mutations";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN, requireStaff } from "@/lib/auth";
import { isOwner, requireHotel, roomInReach } from "@/lib/hotel";
import { audit } from "@/lib/audit";
import { str } from "@/lib/format";
import { newRoomToken } from "@/lib/room-qr";
import type { ActionState } from "@/lib/action-state";

const CONDITIONS = ["ready", "needs_work", "not_available"] as const;
const MAX_PEOPLE = 20;

/**
 * A room can't allow fewer people than are living there or booked to move in.
 * Returns a message naming the rooms that would be over the limit.
 */
async function checkPeopleFit(roomIds: string[], allowed: number): Promise<string | null> {
  if (roomIds.length === 0) return null;
  const db = await getDb();
  const stays = await db
    .select({ roomId: schema.roomAssignments.roomId, number: schema.rooms.number })
    .from(schema.roomAssignments)
    .innerJoin(schema.rooms, eq(schema.roomAssignments.roomId, schema.rooms.id))
    .where(and(inArray(schema.roomAssignments.roomId, roomIds), isNull(schema.roomAssignments.actualCheckOut)));
  const perRoom = new Map<string, { number: string; people: number }>();
  for (const s of stays) perRoom.set(s.roomId, { number: s.number, people: (perRoom.get(s.roomId)?.people ?? 0) + 1 });
  const over = [...perRoom.values()].filter((r) => r.people > allowed).sort((a, b) => a.number.localeCompare(b.number));
  if (over.length === 0) return null;
  const list = over
    .slice(0, 5)
    .map((r) => `room ${r.number} (${r.people})`)
    .join(", ");
  return `Can't set ${allowed} ${allowed === 1 ? "person" : "people"}: more tenants than that live in ${list}${
    over.length > 5 ? ` and ${over.length - 5} more rooms` : ""
  }. Move someone out first, or pick a higher number.`;
}

function readAllowed(fd: FormData) {
  const allowed = Number(fd.get("capacity"));
  if (!Number.isInteger(allowed) || allowed < 1 || allowed > MAX_PEOPLE)
    return { error: `People allowed must be a whole number from 1 to ${MAX_PEOPLE}.` } as const;
  return { value: allowed } as const;
}

function refreshRooms(roomIds: string[] = []) {
  revalidatePath("/");
  revalidatePath("/rooms");
  revalidatePath("/assignments");
  for (const id of roomIds) revalidatePath(`/rooms/${id}`);
}

function readRoom(fd: FormData) {
  const number = str(fd.get("number"));
  const floor = Number(fd.get("floor"));
  const capacity = Number(fd.get("capacity"));
  const roomTypeId = str(fd.get("roomTypeId"));
  const notes = str(fd.get("notes"));
  if (!number) return { error: "Room number is required." } as const;
  if (!Number.isInteger(floor)) return { error: "Floor must be a whole number." } as const;
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > MAX_PEOPLE)
    return { error: `People allowed must be a whole number from 1 to ${MAX_PEOPLE}.` } as const;
  return { value: { number, floor, capacity, roomTypeId, notes } } as const;
}

export async function createRoom(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const { user, hotel } = await requireHotel(CAN.manageRooms);
    const parsed = readRoom(fd);
    if ("error" in parsed) return { error: parsed.error };
    const db = await getDb();
    const clash = await db.query.rooms.findFirst({ where: and(eq(schema.rooms.propertyId, hotel.id), eq(schema.rooms.number, parsed.value.number)) });
    if (clash) return { error: `Room ${parsed.value.number} already exists at ${hotel.name}.` };
    const [room] = await db
      .insert(schema.rooms)
      .values({ ...parsed.value, propertyId: hotel.id, qrToken: newRoomToken() })
      .returning();
    await audit(user.id, "create", "room", room.id, { number: room.number });
    revalidatePath("/rooms");
    return { ok: `Room ${room.number} added.` };
  });
}

export async function updateRoom(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageRooms);
    const parsed = readRoom(fd);
    if ("error" in parsed) return { error: parsed.error };
    const current = await roomInReach(user, id);
    if (!current) return { error: "Room not found." };
    const db = await getDb();
    const clash = await db.query.rooms.findFirst({
      where: and(eq(schema.rooms.propertyId, current.propertyId), eq(schema.rooms.number, parsed.value.number), ne(schema.rooms.id, id)),
    });
    if (clash) return { error: `Another room is already numbered ${parsed.value.number}.` };
    const tooFew = await checkPeopleFit([id], parsed.value.capacity);
    if (tooFew) return { error: tooFew };
    await db.update(schema.rooms).set(parsed.value).where(eq(schema.rooms.id, id));
    await audit(user.id, "update", "room", id, parsed.value);
    refreshRooms([id]);
    return { ok: "Saved." };
  });
}

/** Sets how many people may live in one room. */
export async function setPeopleAllowed(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageRooms);
    const allowed = readAllowed(fd);
    if ("error" in allowed) return { error: allowed.error };
    if (!(await roomInReach(user, id))) return { error: "Room not found." };
    const tooFew = await checkPeopleFit([id], allowed.value);
    if (tooFew) return { error: tooFew };
    const db = await getDb();
    await db.update(schema.rooms).set({ capacity: allowed.value }).where(eq(schema.rooms.id, id));
    await audit(user.id, "set_capacity", "room", id, { capacity: allowed.value });
    refreshRooms([id]);
    return { ok: `Now ${allowed.value} ${allowed.value === 1 ? "person" : "people"} allowed.` };
  });
}

/**
 * Sets people allowed for many rooms at once. `which` is "all", "floor:3",
 * "type:<room type id>" or "room:<room id>".
 */
export async function setPeopleAllowedMany(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const { user, hotel } = await requireHotel(CAN.manageRooms);
    const allowed = readAllowed(fd);
    if ("error" in allowed) return { error: allowed.error };
    const which = String(fd.get("which") ?? "");
    const floor = /^floor:(\d+)$/.exec(which);
    const type = /^type:([0-9a-f-]{36})$/.exec(which);
    const room = /^room:([0-9a-f-]{36})$/.exec(which);
    if (which !== "all" && !floor && !type && !room) return { error: "Pick which rooms to change." };
    const db = await getDb();
    const rooms = await db.query.rooms.findMany({
      columns: { id: true },
      where: and(
        eq(schema.rooms.propertyId, hotel.id),
        floor
          ? eq(schema.rooms.floor, Number(floor[1]))
          : type
            ? eq(schema.rooms.roomTypeId, type[1])
            : room
              ? eq(schema.rooms.id, room[1])
              : undefined,
      ),
    });
    if (rooms.length === 0) return { error: "No rooms match." };
    const ids = rooms.map((r) => r.id);
    const tooFew = await checkPeopleFit(ids, allowed.value);
    if (tooFew) return { error: tooFew };
    await db.update(schema.rooms).set({ capacity: allowed.value }).where(inArray(schema.rooms.id, ids));
    await audit(user.id, "set_capacity", "room", null, { which, capacity: allowed.value, rooms: ids.length });
    refreshRooms(ids);
    return {
      ok: `${ids.length} ${ids.length === 1 ? "room now allows" : "rooms now allow"} ${allowed.value} ${allowed.value === 1 ? "person" : "people"}.`,
    };
  });
}

export async function setRoomCondition(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(["admin", "front_desk", "maintenance"]);
    const condition = String(fd.get("condition"));
    if (!CONDITIONS.includes(condition as (typeof CONDITIONS)[number])) return { error: "Pick a condition." };
    if (!(await roomInReach(user, id))) return { error: "Room not found." };
    const db = await getDb();
    await db
      .update(schema.rooms)
      .set({ condition: condition as (typeof CONDITIONS)[number] })
      .where(eq(schema.rooms.id, id));
    await audit(user.id, "set_condition", "room", id, { condition });
    revalidatePath(`/rooms/${id}`);
    revalidatePath("/");
    return { ok: "Condition updated." };
  });
}

/** Replaces a room's door code. The old printed code stops working. */
export async function replaceDoorCode(id: string): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageRooms);
    if (!(await roomInReach(user, id))) return { error: "Room not found." };
    const db = await getDb();
    const [room] = await db.update(schema.rooms).set({ qrToken: newRoomToken() }).where(eq(schema.rooms.id, id)).returning();
    if (!room) return { error: "Room not found." };
    await audit(user.id, "replace_door_code", "room", id, { number: room.number });
    revalidatePath(`/rooms/${id}`);
    return { ok: "New code made. Print it and replace the one on the door; the old one no longer works." };
  });
}

export async function deleteRoom(id: string): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageRooms);
    if (!(await roomInReach(user, id))) return { error: "Room not found." };
    const db = await getDb();
    const used =
      (await db.query.roomAssignments.findFirst({ where: eq(schema.roomAssignments.roomId, id) })) ??
      (await db.query.contractRooms.findFirst({ where: eq(schema.contractRooms.roomId, id) }));
    if (used) return { error: "This room has contracts or tenants on record, so it can't be deleted. Set its condition to Out of service instead." };
    await db.delete(schema.rooms).where(eq(schema.rooms.id, id));
    await audit(user.id, "delete", "room", id);
    revalidatePath("/rooms");
    return { redirectTo: "/rooms" };
  });
}

export async function saveRoomType(id: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageRooms);
    const name = str(fd.get("name"));
    const defaultCapacity = Number(fd.get("defaultCapacity"));
    if (!name) return { error: "Name is required." };
    if (!Number.isInteger(defaultCapacity) || defaultCapacity < 1 || defaultCapacity > MAX_PEOPLE)
      return { error: `People allowed must be a whole number from 1 to ${MAX_PEOPLE}.` };
    const applyToRooms = id !== null && fd.get("applyToRooms") === "on";
    const db = await getDb();
    const clash = await db.query.roomTypes.findFirst({
      where: id ? and(eq(schema.roomTypes.name, name), ne(schema.roomTypes.id, id)) : eq(schema.roomTypes.name, name),
    });
    if (clash) return { error: `A room type named ${name} already exists.` };
    let changedRooms: string[] = [];
    if (applyToRooms) {
      changedRooms = (
        await db.query.rooms.findMany({
          columns: { id: true },
          // Room types are shared; a hotel's own admin only changes their own hotel's rooms.
          where: and(eq(schema.rooms.roomTypeId, id), isOwner(user) ? undefined : eq(schema.rooms.propertyId, user.propertyId!)),
        })
      ).map((r) => r.id);
      const tooFew = await checkPeopleFit(changedRooms, defaultCapacity);
      if (tooFew) return { error: tooFew };
    }
    if (id) {
      await db.update(schema.roomTypes).set({ name, defaultCapacity }).where(eq(schema.roomTypes.id, id));
      if (changedRooms.length)
        await db.update(schema.rooms).set({ capacity: defaultCapacity }).where(inArray(schema.rooms.id, changedRooms));
    } else {
      await db.insert(schema.roomTypes).values({ name, defaultCapacity });
    }
    await audit(user.id, id ? "update" : "create", "room_type", id, { name, defaultCapacity, roomsChanged: changedRooms.length });
    refreshRooms(changedRooms);
    if (!id) return { ok: `Room type ${name} added.` };
    return {
      ok: changedRooms.length
        ? `Saved. ${changedRooms.length} ${name} ${changedRooms.length === 1 ? "room now allows" : "rooms now allow"} ${defaultCapacity}.`
        : "Saved.",
    };
  });
}
