"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN, requireStaff } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { isHHMM, isISODate, str } from "@/lib/format";
import type { ActionState } from "@/lib/action-state";
import type { TenantRequest } from "@/db/schema";

const STATUSES: TenantRequest["status"][] = ["pending", "approved", "declined", "done"];

export async function updateRequest(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireStaff(CAN.handleRequests);
  const status = String(fd.get("status")) as TenantRequest["status"];
  const scheduledDate = str(fd.get("scheduledDate"));
  const timeFrom = str(fd.get("timeFrom"));
  const timeTo = str(fd.get("timeTo"));
  if (!STATUSES.includes(status)) return { error: "Pick a status." };
  if (scheduledDate && !isISODate(scheduledDate)) return { error: "Enter a valid date." };
  if ((timeFrom && !isHHMM(timeFrom)) || (timeTo && !isHHMM(timeTo))) return { error: "Times must be HH:MM." };
  if (timeFrom && timeTo && timeTo <= timeFrom) return { error: "The end time must be after the start time." };

  const db = await getDb();
  const request = await db.query.tenantRequests.findFirst({ where: eq(schema.tenantRequests.id, id) });
  if (!request) return { error: "Request not found." };
  if (request.kind !== "issue" && status === "approved" && !scheduledDate) {
    return { error: "Set the date you're approving." };
  }

  await db
    .update(schema.tenantRequests)
    .set({
      status,
      scheduledDate,
      scheduledFrom: timeFrom,
      scheduledTo: timeTo,
      response: str(fd.get("response")),
      handledBy: user.id,
      handledAt: new Date(),
    })
    .where(eq(schema.tenantRequests.id, id));

  // An approved maintenance request books a visit for the room, so it shows on
  // the maintenance schedule and the tenant's page. Declining cancels it.
  if (request.kind === "maintenance" && request.roomId) {
    const visit = await db.query.maintenanceVisits.findFirst({
      where: and(eq(schema.maintenanceVisits.requestId, id), eq(schema.maintenanceVisits.status, "scheduled")),
    });
    if (status === "approved" && scheduledDate) {
      const when = { date: scheduledDate, timeFrom, timeTo };
      if (visit) {
        await db.update(schema.maintenanceVisits).set(when).where(eq(schema.maintenanceVisits.id, visit.id));
      } else {
        await db.insert(schema.maintenanceVisits).values({
          ...when,
          roomId: request.roomId,
          requestId: id,
          title: "Requested by tenant",
          notes: request.details,
          createdBy: user.id,
        });
      }
    } else if (visit && status === "declined") {
      await db.update(schema.maintenanceVisits).set({ status: "cancelled" }).where(eq(schema.maintenanceVisits.id, visit.id));
    }
    revalidatePath("/maintenance");
  }

  await audit(user.id, "update", "tenant_request", id, { status, scheduledDate, timeFrom, timeTo });
  revalidatePath("/requests");
  revalidatePath("/me");
  revalidatePath("/me/requests");
  return { ok: "Saved." };
}
