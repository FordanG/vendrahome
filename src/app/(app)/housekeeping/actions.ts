"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN, requireStaff } from "@/lib/auth";
import { requireHotel, roomInReach } from "@/lib/hotel";
import { audit } from "@/lib/audit";
import { str } from "@/lib/format";
import { mutate } from "@/lib/mutations";
import type { ActionState } from "@/lib/action-state";

const MAX_STEPS = 30;

function refresh(roomId?: string) {
  revalidatePath("/housekeeping");
  revalidatePath("/me");
  if (roomId) revalidatePath(`/rooms/${roomId}`);
}

/**
 * Starts a cleaning from the Housekeeping page, without scanning the door code.
 * It is recorded, but shows as not checked in at the door.
 */
export async function startCleaningHere(roomId: string): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.cleanRooms);
    const db = await getDb();
    const room = await roomInReach(user, roomId);
    if (!room) return { error: "Room not found." };
    const open = await db.query.cleanings.findFirst({ where: and(eq(schema.cleanings.roomId, roomId), isNull(schema.cleanings.finishedAt)) });
    if (open) return { redirectTo: `/housekeeping/cleanings/${open.id}` };
    const steps = await db.select().from(schema.cleaningSteps).orderBy(asc(schema.cleaningSteps.position), asc(schema.cleaningSteps.label));
    const [cleaning] = await db
      .insert(schema.cleanings)
      .values({ roomId, staffId: user.id, steps: steps.map((s) => ({ label: s.label, done: false })) })
      .returning();
    await audit(user.id, "start", "cleaning", cleaning.id, { number: room.number, doorCode: false });
    refresh(roomId);
    return { redirectTo: `/housekeeping/cleanings/${cleaning.id}` };
  });
}

/** Saves the ticked steps and notes; with `finish`, closes the cleaning. */
export async function saveCleaning(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.cleanRooms);
    const db = await getDb();
    const cleaning = await db.query.cleanings.findFirst({ where: eq(schema.cleanings.id, id) });
    if (!cleaning || !(await roomInReach(user, cleaning.roomId))) return { error: "Cleaning not found." };
    if (cleaning.finishedAt) return { error: "This cleaning is already finished." };
    const finish = fd.get("finish") === "1";
    const steps = cleaning.steps.map((s, i) => ({ label: s.label, done: fd.get(`step_${i}`) === "on" }));
    const notes = str(fd.get("notes"));
    if (notes && notes.length > 2000) return { error: "Please keep notes under 2,000 characters." };
    await db
      .update(schema.cleanings)
      .set({ steps, notes, ...(finish ? { finishedAt: new Date(), staffId: cleaning.staffId ?? user.id } : {}) })
      .where(eq(schema.cleanings.id, id));
    if (finish) await audit(user.id, "finish", "cleaning", id, { skipped: steps.filter((s) => !s.done).map((s) => s.label) });
    refresh(cleaning.roomId);
    return finish ? { redirectTo: "/housekeeping" } : { ok: "Saved." };
  });
}

/** Throws away a cleaning that was started by mistake. Finished cleanings stay. */
export async function cancelCleaning(id: string): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.cleanRooms);
    const db = await getDb();
    const target = await db.query.cleanings.findFirst({ where: eq(schema.cleanings.id, id) });
    if (!target || !(await roomInReach(user, target.roomId))) return { error: "Only a cleaning that isn't finished can be cancelled." };
    const [gone] = await db.delete(schema.cleanings).where(and(eq(schema.cleanings.id, id), isNull(schema.cleanings.finishedAt))).returning();
    if (!gone) return { error: "Only a cleaning that isn't finished can be cancelled." };
    await audit(user.id, "cancel", "cleaning", id, { roomId: gone.roomId });
    refresh(gone.roomId);
    return { redirectTo: "/housekeeping" };
  });
}

/**
 * Sets how often rooms are cleaned. `which` is "all", "floor:3", "type:<id>" or "room:<id>".
 * A blank number takes the rooms off the schedule.
 */
export async function setCleaningSchedule(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const { user, hotel } = await requireHotel(CAN.manageCleaningSchedule);
    const raw = str(fd.get("every"));
    const every = raw == null ? null : Number(raw);
    if (every !== null && (!Number.isInteger(every) || every < 1 || every > 90)) return { error: "Days between cleanings must be a whole number from 1 to 90, or blank for no schedule." };
    const which = String(fd.get("which") ?? "");
    const floor = /^floor:(-?\d+)$/.exec(which);
    const type = /^type:([0-9a-f-]{36})$/.exec(which);
    const room = /^room:([0-9a-f-]{36})$/.exec(which);
    if (which !== "all" && !floor && !type && !room) return { error: "Pick which rooms." };
    const db = await getDb();
    const rooms = await db.query.rooms.findMany({
      columns: { id: true },
      where: and(
        eq(schema.rooms.propertyId, hotel.id),
        floor ? eq(schema.rooms.floor, Number(floor[1])) : type ? eq(schema.rooms.roomTypeId, type[1]) : room ? eq(schema.rooms.id, room[1]) : undefined,
      ),
    });
    if (rooms.length === 0) return { error: "No rooms match." };
    await db.update(schema.rooms).set({ cleanEveryDays: every }).where(inArray(schema.rooms.id, rooms.map((r) => r.id)));
    await audit(user.id, "set_cleaning_schedule", "room", null, { which, every, rooms: rooms.length });
    refresh();
    const n = `${rooms.length} ${rooms.length === 1 ? "room" : "rooms"}`;
    return { ok: every == null ? `${n} taken off the cleaning schedule.` : `${n} now cleaned every ${every === 1 ? "day" : `${every} days`}.` };
  });
}

/** Replaces the checklist with one step per line. Cleanings already started keep their own copy. */
export async function saveChecklist(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageChecklist);
    const labels = String(fd.get("steps") ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (labels.length > MAX_STEPS) return { error: `Keep the checklist to ${MAX_STEPS} steps or fewer.` };
    if (labels.some((l) => l.length > 200)) return { error: "Keep each step under 200 characters." };
    const db = await getDb();
    await db.delete(schema.cleaningSteps);
    if (labels.length) await db.insert(schema.cleaningSteps).values(labels.map((label, i) => ({ label, position: i + 1 })));
    await audit(user.id, "update", "cleaning_checklist", null, { steps: labels });
    refresh();
    return { ok: `Checklist saved, ${labels.length} ${labels.length === 1 ? "step" : "steps"}.` };
  });
}
