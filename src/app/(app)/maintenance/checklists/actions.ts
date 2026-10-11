"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull, ne } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN, requireStaff } from "@/lib/auth";
import { roomInReach } from "@/lib/hotel";
import { audit } from "@/lib/audit";
import { beginRun } from "@/lib/checklists";
import { str } from "@/lib/format";
import { mutate } from "@/lib/mutations";
import type { ActionState } from "@/lib/action-state";
import type { ChecklistResult } from "@/db/schema";

const RESULTS = ["ok", "fail", "na"] as const;

function refresh() {
  revalidatePath("/maintenance/checklists");
  revalidatePath("/requests");
}

/** Starts a checklist from the room page, without scanning. It is flagged as not scanned. */
export async function startRunHere(roomId: string, checklistId: string): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.runChecklists);
    const room = await roomInReach(user, roomId);
    if (!room) return { error: "Room not found." };
    const run = await beginRun(user, roomId, checklistId, null);
    if (!run) return { error: "That checklist isn't in use." };
    return { redirectTo: `/maintenance/checklists/runs/${run.id}` };
  });
}

/**
 * Saves what was found. With `finish`, every item needs an answer; each problem
 * becomes a staff-reported request for the room.
 */
export async function saveRun(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.runChecklists);
    const db = await getDb();
    const run = await db.query.checklistRuns.findFirst({ where: eq(schema.checklistRuns.id, id) });
    if (!run || !(await roomInReach(user, run.roomId))) return { error: "Checklist not found." };
    if (run.finishedAt) return { error: "This checklist is already finished." };
    const finish = fd.get("finish") === "1";
    const results: ChecklistResult[] = run.results.map((item, i) => {
      const raw = String(fd.get(`result_${i}`) ?? "");
      const note = str(fd.get(`note_${i}`));
      return { label: item.label, result: (RESULTS as readonly string[]).includes(raw) ? (raw as ChecklistResult["result"]) : null, note: note?.slice(0, 500) ?? null };
    });
    if (finish) {
      const missing = results.filter((r) => !r.result);
      if (missing.length) return { error: `Answer every item first: ${missing.map((m) => m.label).join(", ")}.` };
      const unexplained = results.filter((r) => r.result === "fail" && !r.note);
      if (unexplained.length) return { error: `Say what's wrong with: ${unexplained.map((m) => m.label).join(", ")}.` };
    }
    await db
      .update(schema.checklistRuns)
      .set({ results, ...(finish ? { finishedAt: new Date(), staffId: run.staffId ?? user.id } : {}) })
      .where(eq(schema.checklistRuns.id, id));
    if (!finish) return { ok: "Saved." };
    const checklist = await db.query.maintenanceChecklists.findFirst({ where: eq(schema.maintenanceChecklists.id, run.checklistId) });
    const problems = results.filter((r) => r.result === "fail");
    if (problems.length) {
      await db.insert(schema.tenantRequests).values(
        problems.map((p) => ({
          roomId: run.roomId,
          kind: "issue" as const,
          details: `${checklist?.name ?? "Checklist"}: ${p.label}. ${p.note}`,
          reportedBy: user.id,
          assigneeId: user.role === "maintenance" ? user.id : null,
        })),
      );
    }
    await audit(user.id, "finish", "checklist_run", id, { problems: problems.map((p) => p.label) });
    refresh();
    return { redirectTo: `/maintenance/checklists?done=${problems.length}` };
  });
}

export async function cancelRun(id: string): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.runChecklists);
    const db = await getDb();
    const target = await db.query.checklistRuns.findFirst({ where: eq(schema.checklistRuns.id, id) });
    if (!target || !(await roomInReach(user, target.roomId))) return { error: "Only an unfinished checklist can be cancelled." };
    const [gone] = await db.delete(schema.checklistRuns).where(and(eq(schema.checklistRuns.id, id), isNull(schema.checklistRuns.finishedAt))).returning();
    if (!gone) return { error: "Only an unfinished checklist can be cancelled." };
    await audit(user.id, "cancel", "checklist_run", id, { roomId: gone.roomId });
    refresh();
    return { redirectTo: "/maintenance/checklists" };
  });
}

/** Adds or changes a checklist: its name, how often, and its items (one per line). */
export async function saveChecklistTemplate(id: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageMaintenanceChecklists);
    const name = str(fd.get("name"));
    const everyDays = Number(fd.get("everyDays"));
    const items = String(fd.get("items") ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
    if (!name) return { error: "Name the checklist, e.g. Monthly room check." };
    if (!Number.isInteger(everyDays) || everyDays < 1 || everyDays > 730) return { error: "How often must be a whole number of days, from 1 to 730." };
    if (items.length === 0) return { error: "Add at least one item, one per line." };
    if (items.length > 40 || items.some((i) => i.length > 200)) return { error: "Keep it to 40 items of under 200 characters each." };
    const db = await getDb();
    const clash = await db.query.maintenanceChecklists.findFirst({
      where: id ? and(eq(schema.maintenanceChecklists.name, name), ne(schema.maintenanceChecklists.id, id)) : eq(schema.maintenanceChecklists.name, name),
    });
    if (clash) return { error: `There's already a checklist called ${name}.` };
    const values = { name, everyDays, items, active: id ? fd.get("active") === "on" : true };
    if (id) await db.update(schema.maintenanceChecklists).set(values).where(eq(schema.maintenanceChecklists.id, id));
    else await db.insert(schema.maintenanceChecklists).values(values);
    await audit(user.id, id ? "update" : "create", "maintenance_checklist", id, values);
    refresh();
    return { ok: id ? "Saved. Checklists already started keep their items." : `${name} added.` };
  });
}
