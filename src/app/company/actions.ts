"use server";

import { mutate } from "@/lib/mutations";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { COMPANY_CAN, COMPANY_ROLES, requireCompany, signOut } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { isISODate, str, todayISO } from "@/lib/format";
import { readOccupantDetails } from "@/lib/occupants";
import { openAssignmentFor } from "@/lib/assignments";
import { companyOccupant, companyRequestScope, companyRoomIds } from "@/lib/company";
import { createLogin, updateLogin } from "@/lib/logins";
import { savePhoto } from "@/lib/photos";
import type { ActionState } from "@/lib/action-state";
import type { StaffRole } from "@/db/schema";

export async function logout() {
  await signOut();
  redirect("/login");
}

function refresh() {
  revalidatePath("/company", "layout");
  revalidatePath("/assignments");
  revalidatePath("/requests");
}

/** Adds a person to the company, or updates one of its people. Hotel-only notes are kept as they are. */
export async function savePerson(occupantId: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const { user, client } = await requireCompany();
    if (!client.selfManagePeople) return { error: "Your agreement has the front desk keep your people's details. Please ask them." };
    const db = await getDb();
    const current = occupantId ? await companyOccupant(client.id, occupantId) : null;
    if (occupantId && !current) return { error: "Person not found." };
    const details = readOccupantDetails((k) => (k === "notes" ? current?.notes : fd.get(k)));
    if ("error" in details) return details;
    if (current) {
      await db.update(schema.occupants).set(details.value).where(eq(schema.occupants.id, current.id));
      await audit(user.id, "update", "occupant", current.id, { before: current, after: details.value, by: "company" });
      refresh();
      return { ok: "Saved." };
    }
    const [created] = await db
      .insert(schema.occupants)
      .values({ ...details.value, clientId: client.id, status: "inactive" })
      .returning();
    await audit(user.id, "create", "occupant", created.id, { name: created.fullName, by: "company" });
    refresh();
    return { redirectTo: `/company/people/${created.id}` };
  });
}

/** Gives one of the company's people their own tenant login. */
export async function createPersonLogin(occupantId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const { user, client } = await requireCompany();
    if (!client.selfManagePeople) return { error: "Your agreement has the front desk handle tenant logins. Please ask them." };
    const occupant = await companyOccupant(client.id, occupantId);
    if (!occupant) return { error: "Person not found." };
    const db = await getDb();
    if (await db.query.staff.findFirst({ where: eq(schema.staff.occupantId, occupantId) })) return { error: "This person already has a login." };
    const result = await createLogin(fd, { role: "tenant", occupantId, name: occupant.fullName });
    if ("error" in result) return result;
    await audit(user.id, "create", "tenant_login", result.login.id, { occupantId, username: result.login.username, by: "company" });
    refresh();
    return { ok: `${occupant.fullName} can now sign in as ${result.login.username}.` };
  });
}

export async function updatePersonLogin(occupantId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const { user, client } = await requireCompany();
    if (!client.selfManagePeople) return { error: "Your agreement has the front desk handle tenant logins. Please ask them." };
    if (!(await companyOccupant(client.id, occupantId))) return { error: "Person not found." };
    const db = await getDb();
    const login = await db.query.staff.findFirst({
      where: and(eq(schema.staff.occupantId, occupantId), eq(schema.staff.role, "tenant")),
    });
    if (!login) return { error: "This person has no login yet." };
    const result = await updateLogin(login.id, fd);
    if ("error" in result) return result;
    await audit(user.id, "update", "tenant_login", login.id, { ...result, by: "company" });
    refresh();
    return { ok: "Saved." };
  });
}

async function noOpenAsk(occupantId: string) {
  const db = await getDb();
  return !(await db.query.stayRequests.findFirst({
    where: and(eq(schema.stayRequests.occupantId, occupantId), eq(schema.stayRequests.status, "pending")),
  }));
}

/** Asks the front desk to move one of the company's people into one of its rooms. */
export async function askMoveIn(occupantId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const { user, client } = await requireCompany();
    const occupant = await companyOccupant(client.id, occupantId);
    if (!occupant) return { error: "Person not found." };
    const roomId = str(fd.get("roomId"));
    const date = str(fd.get("date"));
    const expectedCheckOut = str(fd.get("expectedCheckOut"));
    const note = str(fd.get("note"));
    if (!roomId) return { error: "Pick a room." };
    if (!isISODate(date) || date < todayISO()) return { error: "Pick a move-in date from today on." };
    if (expectedCheckOut && (!isISODate(expectedCheckOut) || expectedCheckOut < date))
      return { error: "The expected move-out date must be on or after the move-in date." };
    if (note && note.length > 1000) return { error: "Please keep the note under 1,000 characters." };
    if (await openAssignmentFor(occupantId)) return { error: `${occupant.fullName} already has a room. Ask for a move-out first.` };
    if (!(await noOpenAsk(occupantId))) return { error: "There's already an open ask for this person. Cancel it first." };
    const covered = await companyRoomIds(client.id, date);
    if (!covered.some((c) => c.roomId === roomId)) return { error: "That room isn't under your contract on that date." };
    const db = await getDb();
    const [ask] = await db
      .insert(schema.stayRequests)
      .values({ clientId: client.id, kind: "move_in", occupantId, roomId, slot: str(fd.get("slot")), date, expectedCheckOut, note, requestedBy: user.id })
      .returning();
    await audit(user.id, "create", "stay_request", ask.id, { kind: "move_in", occupantId, roomId, date });
    refresh();
    return { ok: "Sent to the front desk. They'll confirm when the room and keys are ready." };
  });
}

/** Tells the front desk one of the company's people is leaving. */
export async function askMoveOut(occupantId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const { user, client } = await requireCompany();
    const occupant = await companyOccupant(client.id, occupantId);
    if (!occupant) return { error: "Person not found." };
    const date = str(fd.get("date"));
    const note = str(fd.get("note"));
    const stay = await openAssignmentFor(occupantId);
    if (!stay) return { error: `${occupant.fullName} has no room right now.` };
    if (!isISODate(date) || date < stay.checkIn) return { error: "Pick a move-out date on or after they moved in." };
    if (note && note.length > 1000) return { error: "Please keep the note under 1,000 characters." };
    if (!(await noOpenAsk(occupantId))) return { error: "There's already an open ask for this person. Cancel it first." };
    const db = await getDb();
    const [ask] = await db
      .insert(schema.stayRequests)
      .values({ clientId: client.id, kind: "move_out", occupantId, roomId: stay.roomId, date, note, requestedBy: user.id, assignmentId: stay.id })
      .returning();
    await audit(user.id, "create", "stay_request", ask.id, { kind: "move_out", occupantId, date });
    refresh();
    return { ok: "Sent to the front desk. They'll check the room and take back the keys." };
  });
}

export async function cancelStayRequest(id: string): Promise<ActionState> {
  return mutate(async () => {
    const { user, client } = await requireCompany();
    const db = await getDb();
    const updated = await db
      .update(schema.stayRequests)
      .set({ status: "cancelled", handledBy: user.id, handledAt: new Date() })
      .where(and(eq(schema.stayRequests.id, id), eq(schema.stayRequests.clientId, client.id), eq(schema.stayRequests.status, "pending")))
      .returning({ id: schema.stayRequests.id });
    if (updated.length === 0) return { error: "This ask was already handled." };
    await audit(user.id, "cancel", "stay_request", id);
    refresh();
    return { ok: "Cancelled." };
  });
}

/** Approves or declines a tenant's request that waits for the company's OK. */
export async function reviewRequest(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const { user, client } = await requireCompany();
    const decision = fd.get("decision");
    const note = str(fd.get("note"));
    if (decision !== "approve" && decision !== "decline") return { error: "Choose approve or decline." };
    if (note && note.length > 1000) return { error: "Please keep the note under 1,000 characters." };
    if (decision === "decline" && !note) return { error: "Say why, so the tenant knows." };
    const db = await getDb();
    const [request] = await db
      .select()
      .from(schema.tenantRequests)
      .where(and(eq(schema.tenantRequests.id, id), eq(schema.tenantRequests.awaitingCompany, true), eq(schema.tenantRequests.status, "pending"), await companyRequestScope(client.id)));
    if (!request || request.cancelledAt) return { error: "This request was already handled or withdrawn." };
    const reviewed = { awaitingCompany: false, companyReviewedBy: user.id, companyReviewedAt: new Date() };
    await db
      .update(schema.tenantRequests)
      .set(
        decision === "approve"
          ? { ...reviewed, details: note ? `${request.details}\n\nFrom ${client.name}: ${note}` : request.details }
          : { ...reviewed, status: "declined", response: `Not approved by ${client.name}: ${note}`, handledBy: user.id, handledAt: new Date() },
      )
      .where(eq(schema.tenantRequests.id, id));
    await audit(user.id, decision, "tenant_request", id, { by: "company", note });
    refresh();
    revalidatePath("/me", "layout");
    return { ok: decision === "approve" ? "Approved. The front desk has it now." : "Declined. The tenant can see why." };
  });
}

/** A company login reports a problem in one of its rooms, e.g. after a visit. */
export async function reportRoomProblem(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const { user, client } = await requireCompany();
    const roomId = str(fd.get("roomId"));
    const details = str(fd.get("details"));
    if (!roomId) return { error: "Pick the room." };
    if (!details) return { error: "Say what's wrong." };
    if (details.length > 2000) return { error: "Please keep it under 2,000 characters." };
    if (!(await companyRoomIds(client.id, todayISO())).some((c) => c.roomId === roomId)) return { error: "That room isn't under your contract." };
    const photo = await savePhoto("request", fd.get("photo"), user.id);
    if (photo && "error" in photo) return { error: photo.error };
    const db = await getDb();
    const [created] = await db
      .insert(schema.tenantRequests)
      .values({ roomId, reportedBy: user.id, photoId: photo?.id ?? null, kind: "issue", details: `${details}\n\nReported by ${user.name}, ${client.name}`, urgent: fd.get("urgent") === "on" })
      .returning();
    await audit(user.id, "create", "tenant_request", created.id, { kind: "issue", by: "company" });
    refresh();
    return { ok: "Sent to the front desk." };
  });
}

/** Company admins add and update their own company's logins. */
export async function saveTeamMember(id: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const { user, client } = await requireCompany(COMPANY_CAN.manageTeam);
    const role = String(fd.get("role")) as StaffRole;
    if (!COMPANY_ROLES.includes(role)) return { error: "Pick a role." };
    const db = await getDb();
    if (!id) {
      const result = await createLogin(fd, { role, clientId: client.id });
      if ("error" in result) return result;
      await audit(user.id, "create", "company_login", result.login.id, { username: result.login.username, role });
      refresh();
      return { ok: `${result.login.name} can now sign in as ${result.login.username}.` };
    }
    const target = await db.query.staff.findFirst({ where: and(eq(schema.staff.id, id), eq(schema.staff.clientId, client.id)) });
    if (!target || !COMPANY_ROLES.includes(target.role)) return { error: "Login not found." };
    if (id === user.id && (fd.get("active") !== "on" || role !== "company_admin"))
      return { error: "You can't remove your own company admin access. Ask another company admin." };
    const result = await updateLogin(id, fd, { role });
    if ("error" in result) return result;
    await audit(user.id, "update", "company_login", id, { ...result, role });
    refresh();
    return { ok: "Saved." };
  });
}
