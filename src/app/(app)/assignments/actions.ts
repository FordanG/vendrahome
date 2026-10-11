"use server";

import { mutate } from "@/lib/mutations";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN, requireStaff } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { isISODate, str, todayISO } from "@/lib/format";
import { checkRoomAvailable, openAssignmentFor } from "@/lib/assignments";
import { roomInReach } from "@/lib/hotel";
import type { ActionState } from "@/lib/action-state";

function refresh() {
  revalidatePath("/", "layout");
  revalidatePath("/company", "layout");
}

async function pendingAsk(id: string) {
  const db = await getDb();
  return db.query.stayRequests.findFirst({ where: and(eq(schema.stayRequests.id, id), eq(schema.stayRequests.status, "pending")) });
}

/** Does what a company asked: the move-in or move-out, with the same checks as doing it by hand. */
export async function confirmStayRequest(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageOccupants);
    const ask = await pendingAsk(id);
    if (!ask || !(await roomInReach(user, ask.roomId))) return { error: "This ask was already handled or cancelled." };
    const db = await getDb();
    const occupant = await db.query.occupants.findFirst({ where: eq(schema.occupants.id, ask.occupantId) });
    if (!occupant || occupant.clientId !== ask.clientId) return { error: "This person no longer belongs to that company." };
    const done = { status: "done" as const, handledBy: user.id, handledAt: new Date(), response: str(fd.get("response")) };

    if (ask.kind === "move_in") {
      const checkIn = str(fd.get("checkIn")) ?? ask.date;
      const slot = fd.has("slot") ? str(fd.get("slot")) : ask.slot;
      if (!isISODate(checkIn)) return { error: "Enter the move-in date." };
      if (!ask.roomId) return { error: "The room asked for no longer exists. Decline and ask the company to pick another." };
      if (await openAssignmentFor(occupant.id)) return { error: `${occupant.fullName} already has a room.` };
      const expectedCheckOut = ask.expectedCheckOut && ask.expectedCheckOut >= checkIn ? ask.expectedCheckOut : null;
      const check = await checkRoomAvailable({ roomId: ask.roomId, slot, checkIn, expectedCheckOut, occupantId: occupant.id, clientId: occupant.clientId });
      if ("error" in check) return check;
      const [stay] = await db
        .insert(schema.roomAssignments)
        .values({
          occupantId: occupant.id,
          roomId: ask.roomId,
          contractId: check.contractId,
          slot,
          checkIn,
          expectedCheckOut,
          keysIssued: str(fd.get("keysIssued")),
          assignedBy: user.id,
          notes: ask.note ? `Asked by the company: ${ask.note}` : "Asked by the company",
        })
        .returning();
      await db.update(schema.occupants).set({ status: "active", propertyId: check.propertyId }).where(eq(schema.occupants.id, occupant.id));
      await db.update(schema.stayRequests).set({ ...done, assignmentId: stay.id }).where(eq(schema.stayRequests.id, ask.id));
      await audit(user.id, "assign", "room_assignment", stay.id, { occupantId: occupant.id, room: check.roomNumber, stayRequestId: ask.id });
      refresh();
      return { ok: `${occupant.fullName} is in room ${check.roomNumber}.` };
    }

    const date = str(fd.get("date"));
    if (!isISODate(date)) return { error: "Enter the move-out date." };
    if (date > todayISO()) return { error: "Confirm a move-out on the day they leave, not before." };
    const stay = await db.query.roomAssignments.findFirst({
      where: and(eq(schema.roomAssignments.occupantId, occupant.id), isNull(schema.roomAssignments.actualCheckOut)),
    });
    if (!stay) return { error: `${occupant.fullName} has no open stay.` };
    if (date < stay.checkIn) return { error: "The move-out date can't be before they moved in." };
    await db
      .update(schema.roomAssignments)
      .set({ actualCheckOut: date, notes: [stay.notes, "Check-out asked by the company"].filter(Boolean).join("\n") })
      .where(eq(schema.roomAssignments.id, stay.id));
    await db.update(schema.occupants).set({ status: "inactive" }).where(eq(schema.occupants.id, occupant.id));
    await db.update(schema.stayRequests).set({ ...done, assignmentId: stay.id }).where(eq(schema.stayRequests.id, ask.id));
    await audit(user.id, "check_out", "room_assignment", stay.id, { before: stay, date, stayRequestId: ask.id });
    refresh();
    return { ok: `${occupant.fullName} moved out.` };
  });
}

export async function declineStayRequest(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageOccupants);
    const response = str(fd.get("response"));
    if (!response) return { error: "Say why, so the company knows what to do next." };
    const ask = await pendingAsk(id);
    if (!ask || !(await roomInReach(user, ask.roomId))) return { error: "This ask was already handled or cancelled." };
    const db = await getDb();
    const updated = await db
      .update(schema.stayRequests)
      .set({ status: "declined", response, handledBy: user.id, handledAt: new Date() })
      .where(and(eq(schema.stayRequests.id, id), eq(schema.stayRequests.status, "pending")))
      .returning({ id: schema.stayRequests.id });
    if (updated.length === 0) return { error: "This ask was already handled or cancelled." };
    await audit(user.id, "decline", "stay_request", id, { response });
    refresh();
    return { ok: "Declined. The company can see why." };
  });
}
