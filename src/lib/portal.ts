import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Tone } from "@/components/ui";
import type { ScheduleEntry, TenantRequest } from "@/db/schema";

// Shared by the tenant pages and the staff pages for schedules, visits and requests.

export const WEEKDAYS = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const SHORT_DAYS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** [1..7] -> "Every day"; [1,2,3,4,5] -> "Mon–Fri"; [2,5] -> "Tue, Fri". */
export function daysLabel(days: number[]): string {
  const d = [...new Set(days)].sort((a, b) => a - b);
  if (d.length === 7) return "Every day";
  const consecutive = d.length > 2 && d.every((x, i) => i === 0 || x === d[i - 1] + 1);
  if (consecutive) return `${SHORT_DAYS[d[0]]}–${SHORT_DAYS[d.at(-1)!]}`;
  return d.map((x) => SHORT_DAYS[x]).join(", ");
}

/**
 * Groups weekly entries that repeat on several days, so "Breakfast 6–7 AM"
 * on all seven days is one row instead of seven.
 */
export function groupByDays<T extends Pick<ScheduleEntry, "weekday" | "startTime" | "endTime" | "note">>(
  entries: T[],
  keyOf: (e: T) => string = (e) => [e.startTime, e.endTime, e.note].join("|"),
) {
  const groups = new Map<string, T[]>();
  for (const e of entries) groups.set(keyOf(e), [...(groups.get(keyOf(e)) ?? []), e]);
  return [...groups.values()]
    .map((list) => ({ entries: list, days: list.map((e) => e.weekday), first: list[0] }))
    .sort((a, b) => a.first.startTime.localeCompare(b.first.startTime) || Math.min(...a.days) - Math.min(...b.days));
}

export const SCHEDULE_KIND_LABELS = { kitchen: "Kitchen use", laundry: "Laundry pickup" } as const;

export const VISIT_STATUS_LABELS = {
  scheduled: "Scheduled",
  done: "Done",
  missed: "Missed",
  cancelled: "Cancelled",
} as const;
export const VISIT_STATUS_TONES: Record<keyof typeof VISIT_STATUS_LABELS, Tone> = {
  scheduled: "blue",
  done: "green",
  missed: "red",
  cancelled: "gray",
};

export const REQUEST_KIND_LABELS = {
  issue: "Problem report",
  maintenance: "Maintenance request",
  laundry: "Laundry request",
} as const;

/** Problem reports read as a ticket; maintenance and laundry requests read as an approval. */
export function requestStatusLabel(r: Pick<TenantRequest, "kind" | "status">): string {
  if (r.kind === "issue") {
    return { pending: "New", approved: "Being fixed", declined: "Closed", done: "Fixed" }[r.status];
  }
  return { pending: "Waiting for approval", approved: "Approved", declined: "Declined", done: "Done" }[r.status];
}
export const REQUEST_STATUS_TONES: Record<TenantRequest["status"], Tone> = {
  pending: "amber",
  approved: "blue",
  declined: "gray",
  done: "green",
};

/**
 * Who a schedule entry or visit batch is for, as a form value:
 * "all", "floor:3" or "room:<id>".
 */
export function parseTarget(v: string | null): { floor: number | null; roomId: string | null } | null {
  if (v === "all") return { floor: null, roomId: null };
  const floor = /^floor:(\d+)$/.exec(v ?? "");
  if (floor) return { floor: Number(floor[1]), roomId: null };
  const room = /^room:([0-9a-f-]{36})$/.exec(v ?? "");
  if (room) return { floor: null, roomId: room[1] };
  return null;
}

export function appliesToRoom(e: Pick<ScheduleEntry, "floor" | "roomId">, room: { id: string; floor: number }) {
  if (e.roomId) return e.roomId === room.id;
  return e.floor == null || e.floor === room.floor;
}

export function scheduleTargetLabel(e: Pick<ScheduleEntry, "floor" | "roomId">, roomNumber?: string | null) {
  if (e.roomId) return `Room ${roomNumber ?? "?"}`;
  if (e.floor != null) return `Floor ${e.floor}`;
  return "Everyone";
}

/** The occupant's current stay and room, or null when they have no room now. */
export async function getCurrentStay(occupantId: string) {
  const db = await getDb();
  const [row] = await db
    .select({ a: schema.roomAssignments, room: schema.rooms })
    .from(schema.roomAssignments)
    .innerJoin(schema.rooms, eq(schema.roomAssignments.roomId, schema.rooms.id))
    .where(and(eq(schema.roomAssignments.occupantId, occupantId), isNull(schema.roomAssignments.actualCheckOut)))
    .orderBy(asc(schema.roomAssignments.checkIn))
    .limit(1);
  return row ?? null;
}

/** Every weekly entry, sorted by day and time, with room numbers. */
export async function getSchedule() {
  const db = await getDb();
  return db
    .select({ e: schema.weeklySchedule, roomNumber: schema.rooms.number })
    .from(schema.weeklySchedule)
    .leftJoin(schema.rooms, eq(schema.weeklySchedule.roomId, schema.rooms.id))
    .orderBy(asc(schema.weeklySchedule.weekday), asc(schema.weeklySchedule.startTime));
}
