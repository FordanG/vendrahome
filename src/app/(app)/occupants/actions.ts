"use server";

import { mutate } from "@/lib/mutations";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN, hashPassword, MIN_PASSWORD, requireStaff } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { addDaysISO, isISODate, str, todayISO } from "@/lib/format";
import { readOccupantDetails } from "@/lib/occupants";
import { checkRoomAvailable, openAssignmentFor } from "@/lib/assignments";
import type { ActionState } from "@/lib/action-state";

function readStay(fd: FormData) {
  const roomId = str(fd.get("roomId"));
  const checkIn = str(fd.get("checkIn"));
  const expectedCheckOut = str(fd.get("expectedCheckOut"));
  if (!roomId) return { error: "Pick a room." } as const;
  if (!isISODate(checkIn)) return { error: "Enter the move-in date." } as const;
  if (expectedCheckOut && (!isISODate(expectedCheckOut) || expectedCheckOut < checkIn))
    return { error: "The expected move-out date must be on or after the move-in date." } as const;
  return {
    value: {
      roomId,
      checkIn,
      expectedCheckOut,
      slot: str(fd.get("slot")),
      keysIssued: str(fd.get("keysIssued")),
      notes: str(fd.get("assignmentNotes")),
    },
  } as const;
}

function refresh(occupantId?: string) {
  revalidatePath("/");
  revalidatePath("/occupants");
  revalidatePath("/assignments");
  if (occupantId) revalidatePath(`/occupants/${occupantId}`);
}

export async function createOccupant(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageOccupants);
    const details = readOccupantDetails((k) => fd.get(k));
    if ("error" in details) return details;
    const clientId = str(fd.get("clientId"));
    const assignNow = !!str(fd.get("roomId"));
    const stay = assignNow ? readStay(fd) : null;
    if (stay && "error" in stay) return { error: stay.error };

    const db = await getDb();
    let contractId: string | null = null;
    if (stay) {
      const check = await checkRoomAvailable({ roomId: stay.value.roomId, slot: stay.value.slot, checkIn: stay.value.checkIn, expectedCheckOut: stay.value.expectedCheckOut, clientId });
      if ("error" in check) return check;
      contractId = check.contractId;
    }

    const [occupant] = await db.insert(schema.occupants).values({ ...details.value, clientId }).returning();
    if (stay) {
      await db.insert(schema.roomAssignments).values({
        ...stay.value,
        occupantId: occupant.id,
        contractId,
        assignedBy: user.id,
      });
    }
    await audit(user.id, "create", "occupant", occupant.id, { name: occupant.fullName, roomId: stay?.value.roomId });
    refresh();
    return { redirectTo: `/occupants/${occupant.id}` };
  });
}

export async function updateOccupant(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageOccupants);
    const details = readOccupantDetails((k) => fd.get(k));
    if ("error" in details) return details;
    const db = await getDb();
    const current = await db.query.occupants.findFirst({ where: eq(schema.occupants.id, id) });
    if (!current) return { error: "Tenant not found." };
    const clientId = str(fd.get("clientId"));
    if (clientId !== current.clientId && await openAssignmentFor(id))
      return { error: "Check out this tenant before changing their company." };
    await db
      .update(schema.occupants)
      .set({ ...details.value, clientId })
      .where(eq(schema.occupants.id, id));
    await audit(user.id, "update", "occupant", id, { before: current, after: { ...details.value, clientId } });
    refresh(id);
    return { ok: "Saved." };
  });
}

export async function assignRoom(occupantId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageOccupants);
    const stay = readStay(fd);
    if ("error" in stay) return { error: stay.error };
    if (await openAssignmentFor(occupantId)) {
      return { error: "This tenant already has a room. Use Move to another room instead." };
    }
    const db = await getDb();
    const occupant = await db.query.occupants.findFirst({ where: eq(schema.occupants.id, occupantId) });
    if (!occupant) return { error: "Tenant not found." };
    const check = await checkRoomAvailable({ ...stay.value, occupantId, clientId: occupant.clientId });
    if ("error" in check) return check;
    const [a] = await db
      .insert(schema.roomAssignments)
      .values({ ...stay.value, occupantId, contractId: check.contractId, assignedBy: user.id })
      .returning();
    await db.update(schema.occupants).set({ status: "active" }).where(eq(schema.occupants.id, occupantId));
    await audit(user.id, "assign", "room_assignment", a.id, { occupantId, room: check.roomNumber });
    refresh(occupantId);
    return { ok: `Assigned to room ${check.roomNumber}.` };
  });
}

export async function transferRoom(assignmentId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageOccupants);
    const db = await getDb();
    const current = await db.query.roomAssignments.findFirst({
      where: and(eq(schema.roomAssignments.id, assignmentId), isNull(schema.roomAssignments.actualCheckOut)),
    });
    if (!current) return { error: "This stay has already ended." };
    const date = str(fd.get("date"));
    const roomId = str(fd.get("roomId"));
    if (!isISODate(date)) return { error: "Enter the date of the move." };
    if (date > todayISO()) return { error: "Record a move only when it happens. Future transfers must not close today's stay." };
    if (date < current.checkIn) return { error: "The move date can't be before they moved in." };
    if (!roomId) return { error: "Pick the new room." };
    if (roomId === current.roomId && str(fd.get("slot")) === current.slot) return { error: "Pick a different room or bed." };
    const slot = str(fd.get("slot"));
    const occupant = await db.query.occupants.findFirst({ where: eq(schema.occupants.id, current.occupantId) });
    const check = await checkRoomAvailable({
      occupantId: current.occupantId,
      clientId: occupant?.clientId ?? null,
      roomId,
      slot,
      checkIn: date,
      exceptAssignmentId: current.id,
    });
    if ("error" in check) return check;

    await db.update(schema.roomAssignments).set({ actualCheckOut: date }).where(eq(schema.roomAssignments.id, current.id));
    const [next] = await db
      .insert(schema.roomAssignments)
      .values({
        occupantId: current.occupantId,
        roomId,
        slot,
        contractId: check.contractId,
        checkIn: date,
        expectedCheckOut: current.expectedCheckOut && current.expectedCheckOut >= date && current.expectedCheckOut <= addDaysISO(check.contractEnd, 1) ? current.expectedCheckOut : null,
        keysIssued: str(fd.get("keysIssued")) ?? current.keysIssued,
        assignedBy: user.id,
        notes: str(fd.get("reason")) ? `Transfer: ${str(fd.get("reason"))}` : "Transfer",
      })
      .returning();
    await audit(user.id, "transfer", "room_assignment", next.id, { before: current, after: next, room: check.roomNumber, date });
    refresh(current.occupantId);
    return { ok: `Moved to room ${check.roomNumber}.` };
  });
}

export async function checkOut(assignmentId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageOccupants);
    const db = await getDb();
    const current = await db.query.roomAssignments.findFirst({ where: eq(schema.roomAssignments.id, assignmentId) });
    if (!current || current.actualCheckOut) return { error: "This stay has already ended." };
    const date = str(fd.get("date"));
    if (!isISODate(date)) return { error: "Enter the move-out date." };
    if (date > todayISO()) return { error: "Actual move-out cannot be in the future. Update the expected move-out date instead." };
    if (date < current.checkIn) return { error: "The move-out date can't be before the move-in date." };
    const note = str(fd.get("note"));
    await db
      .update(schema.roomAssignments)
      .set({
        actualCheckOut: date,
        notes: note ? [current.notes, `Check-out: ${note}`].filter(Boolean).join("\n") : current.notes,
      })
      .where(eq(schema.roomAssignments.id, assignmentId));
    await db.update(schema.occupants).set({ status: "inactive" }).where(eq(schema.occupants.id, current.occupantId));
    await audit(user.id, "check_out", "room_assignment", assignmentId, { before: current, date, note });
    refresh(current.occupantId);
    return { ok: "Moved out." };
  });
}

export async function editAssignment(assignmentId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageOccupants);
    const db = await getDb();
    const current = await db.query.roomAssignments.findFirst({ where: eq(schema.roomAssignments.id, assignmentId) });
    if (!current) return { error: "Stay not found." };
    const checkIn = str(fd.get("checkIn"));
    const expectedCheckOut = str(fd.get("expectedCheckOut"));
    const slot = str(fd.get("slot"));
    if (!isISODate(checkIn)) return { error: "Enter a valid move-in date." };
    if (expectedCheckOut && (!isISODate(expectedCheckOut) || expectedCheckOut < checkIn))
      return { error: "The expected move-out date must be on or after the move-in date." };
    if (current.actualCheckOut && checkIn > current.actualCheckOut)
      return { error: "Move-in cannot be after actual move-out." };
    const occupant = await db.query.occupants.findFirst({ where: eq(schema.occupants.id, current.occupantId) });
    const check = await checkRoomAvailable({
      roomId: current.roomId, slot, checkIn, expectedCheckOut,
      occupantId: current.occupantId, clientId: occupant?.clientId ?? null,
      actualCheckOut: current.actualCheckOut, exceptAssignmentId: current.id,
      historicalContractId: current.actualCheckOut ? current.contractId : undefined,
    });
    if ("error" in check) return check;
    const values = {
      contractId: check.contractId,
      checkIn,
      expectedCheckOut,
      slot,
      keysIssued: str(fd.get("keysIssued")),
      notes: str(fd.get("assignmentNotes")),
    };
    await db.update(schema.roomAssignments).set(values).where(eq(schema.roomAssignments.id, assignmentId));
    await audit(user.id, "update", "room_assignment", assignmentId, { before: current, after: values });
    refresh(current.occupantId);
    return { ok: "Saved." };
  });
}

/** Assign form on the assignment board, where the person is picked from a list. */
export async function assignPickedOccupant(state: ActionState, fd: FormData): Promise<ActionState> {
  const occupantId = str(fd.get("occupantId"));
  if (!occupantId) return { error: "Pick the tenant to give a room to." };
  const result = await assignRoom(occupantId, state, fd);
  if (result.error) return result;
  redirect("/assignments");
}

/** Gives the occupant their own tenant login. */
export async function createTenantLogin(occupantId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageTenantLogins);
    const username = str(fd.get("username"))?.toLowerCase();
    const password = String(fd.get("password") ?? "");
    if (!username || !/^[a-z0-9._-]{3,}$/.test(username)) return { error: "Username: at least 3 letters or numbers, no spaces." };
    if (password.length < MIN_PASSWORD) return { error: `Password must be at least ${MIN_PASSWORD} characters.` };
    const db = await getDb();
    const occupant = await db.query.occupants.findFirst({ where: eq(schema.occupants.id, occupantId) });
    if (!occupant) return { error: "Tenant not found." };
    if (await db.query.staff.findFirst({ where: eq(schema.staff.occupantId, occupantId) }))
      return { error: "This tenant already has a login." };
    if (await db.query.staff.findFirst({ where: eq(schema.staff.username, username) }))
      return { error: `Username ${username} is taken.` };
    const [created] = await db
      .insert(schema.staff)
      .values({ name: occupant.fullName, username, role: "tenant", occupantId, passwordHash: await hashPassword(password) })
      .returning();
    await audit(user.id, "create", "tenant_login", created.id, { occupantId, username });
    refresh(occupantId);
    return { ok: `${occupant.fullName} can now sign in as ${username}.` };
  });
}

export async function updateTenantLogin(occupantId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageTenantLogins);
    const active = fd.get("active") === "on";
    const password = String(fd.get("password") ?? "");
    if (password && password.length < MIN_PASSWORD) return { error: `Password must be at least ${MIN_PASSWORD} characters.` };
    const db = await getDb();
    const login = await db.query.staff.findFirst({
      where: and(eq(schema.staff.occupantId, occupantId), eq(schema.staff.role, "tenant")),
    });
    if (!login) return { error: "This tenant has no login yet." };
    await db
      .update(schema.staff)
      .set({ active, ...(password ? { passwordHash: await hashPassword(password) } : {}) })
      .where(eq(schema.staff.id, login.id));
    if (!active || password) await db.delete(schema.sessions).where(eq(schema.sessions.staffId, login.id));
    await audit(user.id, "update", "tenant_login", login.id, { active, passwordReset: !!password });
    refresh(occupantId);
    return { ok: "Saved." };
  });
}

/** Cancel a planned arrival, never an actual stay; keep the full plan in the audit. */
export async function cancelReservation(assignmentId: string): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageOccupants);
    const db = await getDb();
    const current = await db.query.roomAssignments.findFirst({ where: eq(schema.roomAssignments.id, assignmentId) });
    if (!current || current.actualCheckOut || current.checkIn <= todayISO())
      return { error: "Only a future move-in can be cancelled. Check out an actual stay instead." };
    await audit(user.id, "cancel_reservation", "room_assignment", current.id, { before: current });
    await db.delete(schema.roomAssignments).where(eq(schema.roomAssignments.id, current.id));
    return { ok: "Planned move-in cancelled. The bed is available again." };
  });
}
