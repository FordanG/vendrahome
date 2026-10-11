"use server";

import { mutate } from "@/lib/mutations";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN, requireStaff, STAFF_ROLES } from "@/lib/auth";
import { canUseHotel, requireHotel } from "@/lib/hotel";
import { audit } from "@/lib/audit";
import { isHHMM, isISODate, str } from "@/lib/format";
import { syncVisitRequest, visitPermission } from "@/lib/service-work";
import { parseTarget, VISIT_STATUS_LABELS } from "@/lib/portal";
import type { ActionState } from "@/lib/action-state";

function readWhen(fd: FormData) {
  const date = str(fd.get("date"));
  const timeFrom = str(fd.get("timeFrom"));
  const timeTo = str(fd.get("timeTo"));
  if (!isISODate(date)) return { error: "Enter the date." } as const;
  if ((timeFrom && !isHHMM(timeFrom)) || (timeTo && !isHHMM(timeTo))) return { error: "Times must be HH:MM." } as const;
  if (timeFrom && timeTo && timeTo <= timeFrom) return { error: "The end time must be after the start time." } as const;
  return { value: { date, timeFrom, timeTo } } as const;
}

/** Hotel staff who work at the visit's hotel (or the owner). */
async function validAssignee(id: string | null, hotelId: string) {
  if (!id) return true;
  const owner = await (await getDb()).query.staff.findFirst({ where: eq(schema.staff.id, id) });
  return !!owner?.active && STAFF_ROLES.includes(owner.role) && canUseHotel(owner, hotelId);
}

function refresh() {
  revalidatePath("/maintenance");
  revalidatePath("/me");
}

/** Books one visit per room covered by the target: every room, a floor, or one room. */
export async function scheduleVisits(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const { user, hotel } = await requireHotel(CAN.manageVisits);
    const title = str(fd.get("title"));
    const when = readWhen(fd);
    const target = parseTarget(str(fd.get("target")));
    if (!title) return { error: "Say what the visit is for." };
    if ("error" in when) return { error: when.error };
    if (!target) return { error: "Pick the rooms." };

    const db = await getDb();
    const assigneeId = user.role === "maintenance" ? user.id : str(fd.get("assigneeId"));
    if (!await validAssignee(assigneeId, hotel.id)) return { error: "Choose an active staff member." };
    const rooms = await db.query.rooms.findMany({
      columns: { id: true },
      where: and(
        eq(schema.rooms.propertyId, hotel.id),
        target.roomId
          ? eq(schema.rooms.id, target.roomId)
          : target.floor != null
            ? eq(schema.rooms.floor, target.floor)
            : undefined,
      ),
    });
    if (rooms.length === 0) return { error: "No rooms match." };
    await db.insert(schema.maintenanceVisits).values(
      rooms.map((r) => ({ ...when.value, roomId: r.id, assigneeId, title, notes: str(fd.get("notes")), createdBy: user.id })),
    );
    await audit(user.id, "create", "maintenance_visit", null, { title, ...when.value, ...target, rooms: rooms.length });
    refresh();
    return { ok: `Scheduled ${rooms.length} visit${rooms.length === 1 ? "" : "s"}.` };
  });
}

export async function updateVisit(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageVisits);
    const status = String(fd.get("status")) as keyof typeof VISIT_STATUS_LABELS;
    const when = readWhen(fd);
    if (!Object.hasOwn(VISIT_STATUS_LABELS, status)) return { error: "Pick a status." };
    if ("error" in when) return { error: when.error };
    const db = await getDb();
    const before = await db.query.maintenanceVisits.findFirst({ where: eq(schema.maintenanceVisits.id, id) });
    if (!before) return { error: "Visit not found." };
    const denied = await visitPermission(user, before);
    if (denied) return { error: denied };
    const assigneeId = user.role === "maintenance" ? user.id : fd.has("assigneeId") ? str(fd.get("assigneeId")) : before.assigneeId;
    const room = await db.query.rooms.findFirst({ where: eq(schema.rooms.id, before.roomId) });
    if (!room || !await validAssignee(assigneeId, room.propertyId)) return { error: "Choose an active staff member." };
    const [visit] = await db
      .update(schema.maintenanceVisits)
      .set({ ...when.value, status, assigneeId, notes: str(fd.get("notes")) })
      .where(eq(schema.maintenanceVisits.id, id))
      .returning();
    if (!visit) return { error: "Visit not found." };
    await syncVisitRequest(visit, user);
    await audit(user.id, "update", "maintenance_visit", id, { before, after: visit });
    refresh();
    return { ok: "Saved." };
  });
}

/** Updates a batch of visits booked together, e.g. every room on a floor. */
export async function updateVisitBatch(ids: string[], _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageVisits);
    const status = String(fd.get("status")) as keyof typeof VISIT_STATUS_LABELS;
    const date = str(fd.get("date"));
    if (!Object.hasOwn(VISIT_STATUS_LABELS, status)) return { error: "Pick a status." };
    if (date && !isISODate(date)) return { error: "Enter a valid date." };
    if (ids.length === 0) return { error: "No visits to update." };
    const db = await getDb();
    const before = await db.query.maintenanceVisits.findMany({ where: inArray(schema.maintenanceVisits.id, ids) });
    if (before.length !== new Set(ids).size) return { error: "Some visits no longer exist. Reload the page." };
    for (const visit of before) {
      const denied = await visitPermission(user, visit);
      if (denied) return { error: denied };
    }
    const updated = await db
      .update(schema.maintenanceVisits)
      .set({ status, ...(user.role === "maintenance" ? { assigneeId: user.id } : {}), ...(date ? { date } : {}) })
      .where(inArray(schema.maintenanceVisits.id, ids))
      .returning();
    for (const visit of updated) await syncVisitRequest(visit, user);
    await audit(user.id, "update", "maintenance_visit", null, { before, after: updated });
    refresh();
    return { ok: `Updated ${updated.length} visits.` };
  });
}
