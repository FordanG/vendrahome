import "server-only";
import { asc, eq, isNotNull, max } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { addDaysISO, daysBetween, formatDate, manilaDate } from "./format";

export type CleaningDue = {
  id: string;
  number: string;
  floor: number;
  cleanEveryDays: number;
  lastCleaned: string | null;
  due: string;
  daysLate: number;
};

/**
 * Every room on a cleaning schedule with the date its next cleaning is due:
 * the last finished cleaning plus the room's interval, or today if it was never cleaned.
 */
export async function cleaningsDue(today: string): Promise<CleaningDue[]> {
  const db = await getDb();
  const [rooms, last] = await Promise.all([
    db
      .select({ id: schema.rooms.id, number: schema.rooms.number, floor: schema.rooms.floor, cleanEveryDays: schema.rooms.cleanEveryDays })
      .from(schema.rooms)
      .where(isNotNull(schema.rooms.cleanEveryDays))
      .orderBy(asc(schema.rooms.floor), asc(schema.rooms.number)),
    db
      .select({ roomId: schema.cleanings.roomId, at: max(schema.cleanings.finishedAt) })
      .from(schema.cleanings)
      .where(isNotNull(schema.cleanings.finishedAt))
      .groupBy(schema.cleanings.roomId),
  ]);
  const lastByRoom = new Map(last.map((l) => [l.roomId, l.at ? manilaDate(l.at) : null]));
  return rooms.map((r) => {
    const lastCleaned = lastByRoom.get(r.id) ?? null;
    const due = lastCleaned ? addDaysISO(lastCleaned, r.cleanEveryDays!) : today;
    return { ...r, cleanEveryDays: r.cleanEveryDays!, lastCleaned, due, daysLate: Math.max(0, daysBetween(due, today)) };
  });
}

/** "every day", "every 7 days", "not on a schedule". */
export const everyLabel = (days: number | null) =>
  days == null ? "Not on a cleaning schedule" : days === 1 ? "Every day" : days === 7 ? "Every week" : `Every ${days} days`;

export const lastCleanedLabel = (iso: string | null, today: string) => {
  if (!iso) return "Never cleaned in the app";
  const ago = daysBetween(iso, today);
  return `Last cleaned ${ago === 0 ? "today" : ago === 1 ? "yesterday" : `${formatDate(iso)}, ${ago} days ago`}`;
};

/** One room's schedule and last cleaning, for the room page and the tenant's home page. */
export async function roomCleaning(roomId: string, today: string) {
  const db = await getDb();
  const room = await db.query.rooms.findFirst({ columns: { cleanEveryDays: true }, where: eq(schema.rooms.id, roomId) });
  const [last] = await db
    .select({ at: max(schema.cleanings.finishedAt) })
    .from(schema.cleanings)
    .where(eq(schema.cleanings.roomId, roomId));
  const lastCleaned = last?.at ? manilaDate(last.at) : null;
  const every = room?.cleanEveryDays ?? null;
  const next = every == null ? null : lastCleaned ? addDaysISO(lastCleaned, every) : today;
  return { every, lastCleaned, next: next && next < today ? today : next };
}
