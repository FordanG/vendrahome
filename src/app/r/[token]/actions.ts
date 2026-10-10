"use server";

import { revalidatePath } from "next/cache";
import { and, asc, desc, eq, gt, isNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN, requireStaff } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { formatMoment, str } from "@/lib/format";
import { mutate } from "@/lib/mutations";
import { syncVisitRequest, visitPermission } from "@/lib/service-work";
import type { ActionState } from "@/lib/action-state";
import type { CheckInPurpose, Room, Staff } from "@/db/schema";

// Pressing the button twice, or rescanning a minute later, doesn't add a second check-in.
const REPEAT_WINDOW_MS = 10 * 60_000;
const GONE = "This code no longer works. Ask the front desk for the room's new code.";

async function roomFor(token: string) {
  return (await getDb()).query.rooms.findFirst({ where: eq(schema.rooms.qrToken, token) });
}

/** Records a check-in, or returns the one this person made for the same thing a few minutes ago. */
async function recordCheckIn(user: Staff, room: Room, purpose: CheckInPurpose, visitId: string | null = null) {
  const db = await getDb();
  const recent = await db.query.roomCheckIns.findFirst({
    where: and(
      eq(schema.roomCheckIns.roomId, room.id),
      eq(schema.roomCheckIns.staffId, user.id),
      eq(schema.roomCheckIns.purpose, purpose),
      visitId ? eq(schema.roomCheckIns.visitId, visitId) : isNull(schema.roomCheckIns.visitId),
      gt(schema.roomCheckIns.at, new Date(Date.now() - REPEAT_WINDOW_MS)),
    ),
    orderBy: [desc(schema.roomCheckIns.at)],
  });
  if (recent) return { row: recent, repeat: true };
  const [row] = await db.insert(schema.roomCheckIns).values({ roomId: room.id, staffId: user.id, visitId, purpose }).returning();
  await audit(user.id, "check_in", "room", room.id, { number: room.number, purpose, visitId });
  revalidatePath("/maintenance");
  revalidatePath("/housekeeping");
  return { row, repeat: false };
}

/** Records that a staff member is at the room, optionally for one of its scheduled visits. */
export async function checkIn(token: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.checkInAtRooms);
    const room = await roomFor(token);
    if (!room) return { error: GONE };
    const visitId = str(fd.get("visitId"));
    if (visitId) {
      const visit = await (await getDb()).query.maintenanceVisits.findFirst({ where: eq(schema.maintenanceVisits.id, visitId) });
      if (!visit || visit.roomId !== room.id || visit.status !== "scheduled") return { error: "That visit isn't open for this room any more. Reload the page." };
      const denied = await visitPermission(user, visit);
      if (denied) return { error: denied };
    }
    const { row, repeat } = await recordCheckIn(user, room, visitId ? "visit" : "other", visitId);
    return { ok: repeat ? `You're already checked in, since ${formatMoment(row.at)}.` : `Checked in at Room ${room.number}, ${formatMoment(row.at)}.` };
  });
}

/** Closes a visit from the door once the work is finished. */
export async function finishVisit(token: string, visitId: string): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageVisits);
    const room = await roomFor(token);
    const db = await getDb();
    const before = await db.query.maintenanceVisits.findFirst({ where: eq(schema.maintenanceVisits.id, visitId) });
    if (!room || !before || before.roomId !== room.id || before.status !== "scheduled") return { error: "That visit isn't open for this room any more. Reload the page." };
    const denied = await visitPermission(user, before);
    if (denied) return { error: denied };
    const [visit] = await db
      .update(schema.maintenanceVisits)
      .set({ status: "done", ...(user.role === "maintenance" ? { assigneeId: user.id } : {}) })
      .where(eq(schema.maintenanceVisits.id, visitId))
      .returning();
    await syncVisitRequest(visit, user);
    await audit(user.id, "update", "maintenance_visit", visitId, { before, after: visit, from: "door code" });
    revalidatePath("/maintenance");
    revalidatePath("/me");
    return { ok: "Marked done." };
  });
}

const DOOR_CHECKS = ["move_in", "move_out", "spot"] as const;
export type DoorCheck = (typeof DOOR_CHECKS)[number];

/** Checks in for an items check and opens the room's check form with the kind picked. */
export async function startItemsCheck(token: string, kind: DoorCheck): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.viewInventory);
    if (!DOOR_CHECKS.includes(kind)) return { error: "Pick which check." };
    const room = await roomFor(token);
    if (!room) return { error: GONE };
    await recordCheckIn(user, room, "inventory");
    return { redirectTo: `/inventory/rooms/${room.id}?kind=${kind}#check` };
  });
}

/** Checks in for a cleaning and opens its checklist. Continues the room's unfinished one if there is one. */
export async function startCleaning(token: string): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.cleanRooms);
    const room = await roomFor(token);
    if (!room) return { error: GONE };
    const db = await getDb();
    const open = await db.query.cleanings.findFirst({
      where: and(eq(schema.cleanings.roomId, room.id), isNull(schema.cleanings.finishedAt)),
      orderBy: [desc(schema.cleanings.startedAt)],
    });
    if (open) return { redirectTo: `/housekeeping/cleanings/${open.id}` };
    const { row } = await recordCheckIn(user, room, "cleaning");
    const steps = await db.select().from(schema.cleaningSteps).orderBy(asc(schema.cleaningSteps.position), asc(schema.cleaningSteps.label));
    const [cleaning] = await db
      .insert(schema.cleanings)
      .values({ roomId: room.id, staffId: user.id, checkInId: row.id, startedAt: row.at, steps: steps.map((s) => ({ label: s.label, done: false })) })
      .returning();
    await audit(user.id, "start", "cleaning", cleaning.id, { number: room.number });
    return { redirectTo: `/housekeeping/cleanings/${cleaning.id}` };
  });
}
