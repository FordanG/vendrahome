import "server-only";
import { and, desc, eq, ne, or, isNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { inHotelAreas, inHotelRooms, roomInReach } from "./hotel";
import type { Staff, TenantRequest, MaintenanceVisit } from "@/db/schema";

export function canHandleRequest(user: Pick<Staff, "id" | "role">, request: Pick<TenantRequest, "kind" | "assigneeId">) {
  return user.role === "admin" || user.role === "front_desk" ||
    (user.role === "maintenance" && request.kind !== "laundry" && (!request.assigneeId || request.assigneeId === user.id));
}

/** A request owns one current appointment. Older visits remain historical. */
export async function syncRequestVisit(request: TenantRequest, actorId: string) {
  if (request.kind === "laundry" || !request.roomId) return;
  const db = await getDb();
  const latest = await db.query.maintenanceVisits.findFirst({
    where: eq(schema.maintenanceVisits.requestId, request.id),
    orderBy: [desc(schema.maintenanceVisits.createdAt), desc(schema.maintenanceVisits.id)],
  });
  if (request.status === "approved" && request.scheduledDate) {
    const values = { assigneeId: request.assigneeId, date: request.scheduledDate, timeFrom: request.scheduledFrom, timeTo: request.scheduledTo, status: "scheduled" as const };
    if (latest) {
      await db.update(schema.maintenanceVisits).set(values).where(eq(schema.maintenanceVisits.id, latest.id));
      await db.update(schema.maintenanceVisits).set({ status: "cancelled" }).where(and(
        eq(schema.maintenanceVisits.requestId, request.id), eq(schema.maintenanceVisits.status, "scheduled"), ne(schema.maintenanceVisits.id, latest.id),
      ));
    } else {
      await db.insert(schema.maintenanceVisits).values({ ...values, roomId: request.roomId, requestId: request.id,
        title: request.kind === "issue" ? "Repair reported by tenant" : "Requested by tenant", notes: request.details, createdBy: actorId });
    }
  } else {
    await db.update(schema.maintenanceVisits).set({ status: request.status === "done" ? "done" : "cancelled" })
      .where(and(eq(schema.maintenanceVisits.requestId, request.id), eq(schema.maintenanceVisits.status, "scheduled")));
  }
}

export async function visitPermission(user: Pick<Staff, "id" | "role" | "propertyId">, visit: MaintenanceVisit): Promise<string | null> {
  const db = await getDb();
  if (!(await roomInReach(user, visit.roomId))) return "Visit not found.";
  if (!visit.requestId) return user.role === "maintenance" && visit.assigneeId && visit.assigneeId !== user.id
    ? "This visit is assigned to another staff member." : null;
  const request = await db.query.tenantRequests.findFirst({ where: eq(schema.tenantRequests.id, visit.requestId) });
  if (!request || request.cancelledAt || !canHandleRequest(user, request)) return "You cannot change this request's visit.";
  const latest = await db.query.maintenanceVisits.findFirst({ where: eq(schema.maintenanceVisits.requestId, request.id), orderBy: [desc(schema.maintenanceVisits.createdAt), desc(schema.maintenanceVisits.id)] });
  return latest?.id !== visit.id ? "This visit is historical. Update the request's latest visit." : null;
}

/** A missed/cancelled appointment returns the unresolved request to the queue. */
export async function syncVisitRequest(visit: MaintenanceVisit, user: Pick<Staff, "id" | "role">) {
  if (!visit.requestId) return;
  const db = await getDb();
  const scheduled = visit.status === "scheduled" || visit.status === "done";
  await db.update(schema.tenantRequests).set({
    status: visit.status === "done" ? "done" : visit.status === "scheduled" ? "approved" : "pending",
    scheduledDate: scheduled ? visit.date : null,
    scheduledFrom: scheduled ? visit.timeFrom : null,
    scheduledTo: scheduled ? visit.timeTo : null,
    assigneeId: visit.assigneeId,
    handledBy: user.id, handledAt: new Date(),
  }).where(eq(schema.tenantRequests.id, visit.requestId));
}

/**
 * The requests a hotel login works on, in one hotel when `hotelId` is given.
 * Requests still waiting for a company's OK aren't the hotel's yet.
 */
export function requestScope(user: Pick<Staff, "id" | "role">, hotelId?: string) {
  return and(
    eq(schema.tenantRequests.awaitingCompany, false),
    hotelId ? or(inHotelRooms(schema.tenantRequests.roomId, hotelId), inHotelAreas(schema.tenantRequests.areaId, hotelId)) : undefined,
    user.role === "maintenance" ? and(ne(schema.tenantRequests.kind, "laundry"),
      or(isNull(schema.tenantRequests.assigneeId), eq(schema.tenantRequests.assigneeId, user.id))) : undefined,
  );
}
