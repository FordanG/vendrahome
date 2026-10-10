import "server-only";
import { and, desc, eq, gte, isNotNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { FeedbackTopic } from "@/db/schema";
import { addDaysISO, manilaDate, todayISO } from "./format";

export const TOPIC_LABELS: Record<FeedbackTopic, string> = { cleaning: "Room cleaning", repair: "Repair or maintenance", laundry: "Laundry" };
export const RATE_DAYS = 14;
export const FLAG_AT = 3;

export type ToRate = { topic: FeedbackTopic; subjectId: string; when: Date; label: string; roomId: string | null };

/**
 * What a tenant can still rate: cleanings of their room and finished visits to it
 * since they moved in, and their own laundry, from the last two weeks.
 */
export async function toRate(occupantId: string, stay: { roomId: string; checkIn: string } | null): Promise<ToRate[]> {
  const db = await getDb();
  const since = new Date(addDaysISO(todayISO(), -RATE_DAYS) + "T16:00:00Z");
  const [rated, cleanings, visits, loads] = await Promise.all([
    db.select({ id: schema.feedback.subjectId }).from(schema.feedback).where(eq(schema.feedback.occupantId, occupantId)),
    stay
      ? db
          .select({ id: schema.cleanings.id, at: schema.cleanings.finishedAt })
          .from(schema.cleanings)
          .where(and(eq(schema.cleanings.roomId, stay.roomId), isNotNull(schema.cleanings.finishedAt), gte(schema.cleanings.finishedAt, since)))
          .orderBy(desc(schema.cleanings.finishedAt))
      : [],
    stay
      ? db
          .select({ id: schema.maintenanceVisits.id, title: schema.maintenanceVisits.title, date: schema.maintenanceVisits.date, createdAt: schema.maintenanceVisits.createdAt })
          .from(schema.maintenanceVisits)
          .where(and(eq(schema.maintenanceVisits.roomId, stay.roomId), eq(schema.maintenanceVisits.status, "done"), gte(schema.maintenanceVisits.date, addDaysISO(todayISO(), -RATE_DAYS))))
          .orderBy(desc(schema.maintenanceVisits.date))
      : [],
    db
      .select({ id: schema.laundryLoads.id, number: schema.laundryLoads.number, at: schema.laundryLoads.collectedAt, roomId: schema.laundryLoads.roomId })
      .from(schema.laundryLoads)
      .where(and(eq(schema.laundryLoads.occupantId, occupantId), eq(schema.laundryLoads.status, "collected"), gte(schema.laundryLoads.collectedAt, since)))
      .orderBy(desc(schema.laundryLoads.collectedAt)),
  ]);
  const done = new Set(rated.map((r) => r.id));
  const items: ToRate[] = [
    ...cleanings
      .filter((c) => stay && manilaDate(c.at!) >= stay.checkIn)
      .map((c) => ({ topic: "cleaning" as const, subjectId: c.id, when: c.at!, label: "Your room was cleaned", roomId: stay!.roomId })),
    ...visits
      .filter((v) => stay && v.date >= stay.checkIn)
      .map((v) => ({ topic: "repair" as const, subjectId: v.id, when: new Date(v.date + "T04:00:00Z"), label: v.title, roomId: stay!.roomId })),
    ...loads.map((l) => ({ topic: "laundry" as const, subjectId: l.id, when: l.at!, label: `Laundry, load ${l.number}`, roomId: l.roomId })),
  ];
  return items.filter((i) => !done.has(i.subjectId)).sort((a, b) => b.when.getTime() - a.when.getTime());
}

/** Average stars and count per topic over the last `days` days. */
export async function feedbackSummary(days: number) {
  const db = await getDb();
  const rows = await db
    .select({ topic: schema.feedback.topic, stars: schema.feedback.stars })
    .from(schema.feedback)
    .where(gte(schema.feedback.createdAt, new Date(addDaysISO(todayISO(), -days) + "T16:00:00Z")));
  return (Object.keys(TOPIC_LABELS) as FeedbackTopic[]).map((topic) => {
    const mine = rows.filter((r) => r.topic === topic);
    return { topic, count: mine.length, average: mine.length ? mine.reduce((n, r) => n + r.stars, 0) / mine.length : null };
  });
}

