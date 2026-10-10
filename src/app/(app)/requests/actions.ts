"use server";

import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { mutate } from "@/lib/mutations";
import { CAN, requireStaff } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { formatPeso, isHHMM, isISODate, parsePeso, str, todayISO } from "@/lib/format";
import { addServiceCharge } from "@/lib/billing";
import { savePhoto } from "@/lib/photos";
import { canHandleRequest, syncRequestVisit } from "@/lib/service-work";
import { getCurrentStay } from "@/lib/portal";
import type { ActionState } from "@/lib/action-state";
import type { TenantRequest } from "@/db/schema";

const STATUSES: TenantRequest["status"][] = ["pending", "approved", "declined", "done"];

export async function updateRequest(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.handleRequests);
    const status = String(fd.get("status")) as TenantRequest["status"];
    const scheduledDate = str(fd.get("scheduledDate"));
    const timeFrom = str(fd.get("timeFrom"));
    const timeTo = str(fd.get("timeTo"));
    if (!STATUSES.includes(status)) return { error: "Pick a status." };
    if (scheduledDate && !isISODate(scheduledDate)) return { error: "Enter a valid date." };
    if ((timeFrom && !isHHMM(timeFrom)) || (timeTo && !isHHMM(timeTo))) return { error: "Times must be HH:MM." };
    if (timeFrom && timeTo && timeTo <= timeFrom) return { error: "The end time must be after the start time." };
    if ((timeFrom || timeTo) && !scheduledDate) return { error: "Set a date for the appointment times." };
    const db = await getDb();
    const request = await db.query.tenantRequests.findFirst({ where: eq(schema.tenantRequests.id, id) });
    if (!request || !canHandleRequest(user, request)) return { error: "You cannot handle this request." };
    if (request.cancelledAt) return { error: "The tenant withdrew this request. Create a new request if needed." };
    if (request.kind !== "issue" && status === "approved" && !scheduledDate) return { error: "Set the date you're approving." };
    const assigneeId = user.role === "maintenance" ? user.id : fd.has("assigneeId") ? str(fd.get("assigneeId")) : request.assigneeId;
    const dueDate = fd.has("dueDate") ? str(fd.get("dueDate")) : request.dueDate;
    if (dueDate && !isISODate(dueDate)) return { error: "Enter a valid due date." };
    if (assigneeId) {
      const owner = await db.query.staff.findFirst({ where: eq(schema.staff.id, assigneeId) });
      if (!owner?.active || owner.role === "tenant" || (request.kind === "laundry" && owner.role === "maintenance"))
        return { error: "Choose an active staff member who can handle this kind of work." };
    }
    const keepAppointment = status === "approved" || status === "done";
    const [updated] = await db.update(schema.tenantRequests).set({
      status, assigneeId, dueDate,
      scheduledDate: keepAppointment ? scheduledDate ?? (status === "done" ? request.scheduledDate : null) : null,
      scheduledFrom: keepAppointment ? timeFrom ?? (status === "done" ? request.scheduledFrom : null) : null,
      scheduledTo: keepAppointment ? timeTo ?? (status === "done" ? request.scheduledTo : null) : null,
      response: str(fd.get("response")), handledBy: user.id, handledAt: new Date(),
    }).where(eq(schema.tenantRequests.id, id)).returning();
    await syncRequestVisit(updated, user.id);
    await audit(user.id, "update", "tenant_request", id, { before: request, after: updated });
    return { ok: "Saved." };
  });
}

export async function createStaffRequest(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageOccupants);
    const occupantId = str(fd.get("occupantId"));
    const kind = String(fd.get("kind")) as TenantRequest["kind"];
    const details = str(fd.get("details"));
    if (!occupantId || !["issue", "maintenance", "laundry"].includes(kind) || !details || details.length > 2000)
      return { error: "Choose a tenant and request type, and enter details (up to 2,000 characters)." };
    const stay = await getCurrentStay(occupantId);
    if (!stay) return { error: "This tenant has no current room. Assign their room first." };
    const db = await getDb();
    const [request] = await db.insert(schema.tenantRequests).values({ occupantId, roomId: stay.room.id, kind, details,
      urgent: fd.get("urgent") === "on", assigneeId: user.id }).returning();
    await audit(user.id, "create_for_tenant", "tenant_request", request.id, { occupantId, roomId: stay.room.id, kind });
    return { ok: "Request logged." };
  });
}

/**
 * Staff report a problem they found in a room, e.g. while cleaning or on a checklist.
 * It joins the request queue like a tenant's report.
 */
export async function reportProblem(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.handleRequests);
    const roomId = str(fd.get("roomId"));
    const details = str(fd.get("details"));
    if (!roomId) return { error: "Pick the room." };
    if (!details) return { error: "Say what's wrong." };
    if (details.length > 2000) return { error: "Please keep it under 2,000 characters." };
    const db = await getDb();
    const room = await db.query.rooms.findFirst({ where: eq(schema.rooms.id, roomId) });
    if (!room) return { error: "Room not found." };
    const photo = await savePhoto("request", fd.get("photo"), user.id);
    if (photo && "error" in photo) return { error: photo.error };
    const [request] = await db
      .insert(schema.tenantRequests)
      .values({
        roomId,
        kind: "issue",
        details,
        urgent: fd.get("urgent") === "on",
        reportedBy: user.id,
        photoId: photo?.id ?? null,
        assigneeId: user.role === "maintenance" ? user.id : null,
      })
      .returning();
    await audit(user.id, "report", "tenant_request", request.id, { room: room.number });
    return { ok: `Reported for room ${room.number}.` };
  });
}

/**
 * Records what a repair cost and who pays. A company or tenant payer gets a Damage charge;
 * the hotel paying just keeps the cost on record. A charge is added only once.
 */
export async function recordRepairCost(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.handleRequests);
    const cost = parsePeso(fd.get("cost"));
    const paidBy = String(fd.get("paidBy"));
    if (!cost) return { error: "Enter what the repair cost, parts and labour." };
    if (paidBy !== "hotel" && paidBy !== "company" && paidBy !== "occupant") return { error: "Pick who pays." };
    if (paidBy !== "hotel" && !CAN.recordBilling.includes(user.role)) return { error: "Only the front desk or admin can charge a repair to someone." };
    const db = await getDb();
    const request = await db.query.tenantRequests.findFirst({ where: eq(schema.tenantRequests.id, id) });
    if (!request || !canHandleRequest(user, request)) return { error: "You cannot handle this request." };
    if (request.chargeId) return { error: "This repair was already charged. Reverse the charge in Billing to change it." };
    if (paidBy === "occupant" && !request.occupantId) return { error: "No tenant reported this, so there's no tenant to charge." };
    let chargeId: string | null = null;
    if (paidBy !== "hotel") {
      const charge = await addServiceCharge({
        typeCode: "damage",
        occupantId: request.occupantId,
        roomId: request.roomId,
        amount: cost,
        chargedOn: todayISO(),
        description: `Repair: ${request.details.slice(0, 80)}`,
        staffId: user.id,
        billTo: paidBy,
      });
      if ("error" in charge) return { error: charge.error };
      chargeId = charge.id;
    }
    await db.update(schema.tenantRequests).set({ cost, paidBy, chargeId }).where(eq(schema.tenantRequests.id, id));
    await audit(user.id, "repair_cost", "tenant_request", id, { cost, paidBy, chargeId });
    return { ok: paidBy === "hotel" ? `Cost of ${formatPeso(cost)} saved.` : `${formatPeso(cost)} charged to the ${paidBy === "company" ? "company" : "tenant"}.` };
  });
}
