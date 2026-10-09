"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, gt } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN, requireStaff } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { formatMoment, str } from "@/lib/format";
import { mutate } from "@/lib/mutations";
import { syncVisitRequest, visitPermission } from "@/lib/service-work";
import type { ActionState } from "@/lib/action-state";

// Pressing the button twice, or rescanning a minute later, doesn't add a second check-in.
const REPEAT_WINDOW_MS = 10 * 60_000;

async function roomFor(token: string) {
  return (await getDb()).query.rooms.findFirst({ where: eq(schema.rooms.qrToken, token) });
}

/** Records that a staff member is at the room, optionally for one of its scheduled visits. */
export async function checkIn(token: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.checkInAtRooms);
    const room = await roomFor(token);
    if (!room) return { error: "This code no longer works. Ask the front desk for the room's new code." };
    const db = await getDb();
    const visitId = str(fd.get("visitId"));
    if (visitId) {
      const visit = await db.query.maintenanceVisits.findFirst({ where: eq(schema.maintenanceVisits.id, visitId) });
      if (!visit || visit.roomId !== room.id || visit.status !== "scheduled") return { error: "That visit isn't open for this room any more. Reload the page." };
      const denied = await visitPermission(user, visit);
      if (denied) return { error: denied };
    }
    const recent = await db.query.roomCheckIns.findFirst({
      where: and(
        eq(schema.roomCheckIns.roomId, room.id),
        eq(schema.roomCheckIns.staffId, user.id),
        gt(schema.roomCheckIns.at, new Date(Date.now() - REPEAT_WINDOW_MS)),
      ),
      orderBy: [desc(schema.roomCheckIns.at)],
    });
    if (recent && recent.visitId === visitId) return { ok: `You're already checked in, since ${formatMoment(recent.at)}.` };
    const [row] = await db.insert(schema.roomCheckIns).values({ roomId: room.id, staffId: user.id, visitId }).returning();
    await audit(user.id, "check_in", "room", room.id, { number: room.number, visitId });
    revalidatePath("/maintenance");
    return { ok: `Checked in at Room ${room.number}, ${formatMoment(row.at)}.` };
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
