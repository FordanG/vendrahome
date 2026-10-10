import "server-only";
import { and, asc, eq, isNotNull, isNull, max } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { ChecklistResult, Staff } from "@/db/schema";
import { audit } from "./audit";
import { addDaysISO, daysBetween, manilaDate } from "./format";

export const RESULT_LABELS: Record<NonNullable<ChecklistResult["result"]>, string> = {
  ok: "OK",
  fail: "Problem",
  na: "Not in this room",
};

export type ChecklistDue = { roomId: string; number: string; floor: number; lastDone: string | null; due: string; daysLate: number };

/**
 * For each active checklist, every room with the date it's next due: its last finished run
 * plus the checklist's cycle, or today if it was never run.
 */
export async function checklistsDue(today: string) {
  const db = await getDb();
  const [checklists, rooms, last] = await Promise.all([
    db.select().from(schema.maintenanceChecklists).where(eq(schema.maintenanceChecklists.active, true)).orderBy(asc(schema.maintenanceChecklists.everyDays), asc(schema.maintenanceChecklists.name)),
    db.select({ id: schema.rooms.id, number: schema.rooms.number, floor: schema.rooms.floor }).from(schema.rooms).orderBy(asc(schema.rooms.floor), asc(schema.rooms.number)),
    db
      .select({ roomId: schema.checklistRuns.roomId, checklistId: schema.checklistRuns.checklistId, at: max(schema.checklistRuns.finishedAt) })
      .from(schema.checklistRuns)
      .where(isNotNull(schema.checklistRuns.finishedAt))
      .groupBy(schema.checklistRuns.roomId, schema.checklistRuns.checklistId),
  ]);
  const lastDone = new Map(last.map((l) => [`${l.roomId}|${l.checklistId}`, l.at ? manilaDate(l.at) : null]));
  return checklists.map((c) => ({
    checklist: c,
    rooms: rooms.map((r): ChecklistDue => {
      const done = lastDone.get(`${r.id}|${c.id}`) ?? null;
      const due = done ? addDaysISO(done, c.everyDays) : today;
      return { roomId: r.id, number: r.number, floor: r.floor, lastDone: done, due, daysLate: Math.max(0, daysBetween(due, today)) };
    }),
  }));
}

/** One room's checklists and when each is due, for the room page and the door code. */
export async function roomChecklists(roomId: string, today: string) {
  const all = await checklistsDue(today);
  return all.map(({ checklist, rooms }) => ({ checklist, ...rooms.find((r) => r.roomId === roomId)! }));
}

/** The room's unfinished run of a checklist, if someone started one. */
export async function openRun(roomId: string, checklistId: string) {
  const db = await getDb();
  return db.query.checklistRuns.findFirst({
    where: and(eq(schema.checklistRuns.roomId, roomId), eq(schema.checklistRuns.checklistId, checklistId), isNull(schema.checklistRuns.finishedAt)),
  });
}

/** Starts a run of a checklist in a room, or continues the one already open. Used by the door code too. */
export async function beginRun(user: Staff, roomId: string, checklistId: string, checkInId: string | null) {
  const db = await getDb();
  const open = await openRun(roomId, checklistId);
  if (open) return open;
  const checklist = await db.query.maintenanceChecklists.findFirst({ where: eq(schema.maintenanceChecklists.id, checklistId) });
  if (!checklist?.active) return null;
  const [run] = await db
    .insert(schema.checklistRuns)
    .values({
      roomId,
      checklistId,
      staffId: user.id,
      checkInId,
      results: checklist.items.map((label) => ({ label, result: null, note: null })),
    })
    .returning();
  await audit(user.id, "start", "checklist_run", run.id, { checklist: checklist.name, roomId, doorCode: !!checkInId });
  return run;
}

