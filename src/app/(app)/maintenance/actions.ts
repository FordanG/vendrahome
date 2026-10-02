"use server";

import { revalidatePath } from "next/cache";
import { eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN, requireStaff } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { isHHMM, isISODate, str } from "@/lib/format";
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

function refresh() {
  revalidatePath("/maintenance");
  revalidatePath("/me");
}

/** Books one visit per room covered by the target: every room, a floor, or one room. */
export async function scheduleVisits(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireStaff(CAN.manageVisits);
  const title = str(fd.get("title"));
  const when = readWhen(fd);
  const target = parseTarget(str(fd.get("target")));
  if (!title) return { error: "Say what the visit is for." };
  if ("error" in when) return { error: when.error };
  if (!target) return { error: "Pick the rooms." };

  const db = await getDb();
  const rooms = await db.query.rooms.findMany({
    columns: { id: true },
    where: target.roomId
      ? eq(schema.rooms.id, target.roomId)
      : target.floor != null
        ? eq(schema.rooms.floor, target.floor)
        : undefined,
  });
  if (rooms.length === 0) return { error: "No rooms match." };
  await db.insert(schema.maintenanceVisits).values(
    rooms.map((r) => ({ ...when.value, roomId: r.id, title, notes: str(fd.get("notes")), createdBy: user.id })),
  );
  await audit(user.id, "create", "maintenance_visit", null, { title, ...when.value, ...target, rooms: rooms.length });
  refresh();
  return { ok: `Scheduled ${rooms.length} visit${rooms.length === 1 ? "" : "s"}.` };
}

export async function updateVisit(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireStaff(CAN.manageVisits);
  const status = String(fd.get("status")) as keyof typeof VISIT_STATUS_LABELS;
  const when = readWhen(fd);
  if (!(status in VISIT_STATUS_LABELS)) return { error: "Pick a status." };
  if ("error" in when) return { error: when.error };
  const db = await getDb();
  const [visit] = await db
    .update(schema.maintenanceVisits)
    .set({ ...when.value, status, notes: str(fd.get("notes")) })
    .where(eq(schema.maintenanceVisits.id, id))
    .returning();
  if (!visit) return { error: "Visit not found." };
  // A visit booked from a tenant request closes the request when it's done.
  if (visit.requestId && status === "done") {
    await db
      .update(schema.tenantRequests)
      .set({ status: "done", handledBy: user.id, handledAt: new Date() })
      .where(eq(schema.tenantRequests.id, visit.requestId));
    revalidatePath("/requests");
    revalidatePath("/me/requests");
  }
  await audit(user.id, "update", "maintenance_visit", id, { status, ...when.value });
  refresh();
  return { ok: "Saved." };
}

/** Updates a batch of visits booked together, e.g. every room on a floor. */
export async function updateVisitBatch(ids: string[], _: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireStaff(CAN.manageVisits);
  const status = String(fd.get("status")) as keyof typeof VISIT_STATUS_LABELS;
  const date = str(fd.get("date"));
  if (!(status in VISIT_STATUS_LABELS)) return { error: "Pick a status." };
  if (date && !isISODate(date)) return { error: "Enter a valid date." };
  if (ids.length === 0) return { error: "No visits to update." };
  const db = await getDb();
  const updated = await db
    .update(schema.maintenanceVisits)
    .set({ status, ...(date ? { date } : {}) })
    .where(inArray(schema.maintenanceVisits.id, ids))
    .returning({ requestId: schema.maintenanceVisits.requestId });
  const requestIds = updated.map((v) => v.requestId).filter((id): id is string => !!id);
  if (status === "done" && requestIds.length) {
    await db
      .update(schema.tenantRequests)
      .set({ status: "done", handledBy: user.id, handledAt: new Date() })
      .where(inArray(schema.tenantRequests.id, requestIds));
    revalidatePath("/requests");
    revalidatePath("/me/requests");
  }
  await audit(user.id, "update", "maintenance_visit", null, { ids, status, date });
  refresh();
  return { ok: `Updated ${updated.length} visits.` };
}
