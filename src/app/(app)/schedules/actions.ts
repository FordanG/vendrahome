"use server";

import { mutate } from "@/lib/mutations";

import { revalidatePath } from "next/cache";
import { inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN, requireStaff } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { isHHMM, str } from "@/lib/format";
import { parseTarget } from "@/lib/portal";
import type { ActionState } from "@/lib/action-state";

function refresh() {
  revalidatePath("/schedules");
  revalidatePath("/me");
  revalidatePath("/me/requests");
}

export async function addScheduleEntry(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageSchedules);
    const kind = String(fd.get("kind"));
    const days = fd.getAll("weekday").map(Number);
    const startTime = str(fd.get("startTime"));
    const endTime = str(fd.get("endTime"));
    const target = parseTarget(str(fd.get("target")));
    if (kind !== "kitchen" && kind !== "laundry") return { error: "Pick kitchen or laundry." };
    if (days.length === 0 || days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) return { error: "Pick at least one day." };
    if (!isHHMM(startTime) || !isHHMM(endTime)) return { error: "Enter start and end times." };
    if (endTime <= startTime) return { error: "End time must be after the start time." };
    if (!target) return { error: "Pick who this is for." };

    const db = await getDb();
    const values = days.map((weekday) => ({ kind, weekday, startTime, endTime, note: str(fd.get("note")), ...target }) as const);
    const created = await db.insert(schema.weeklySchedule).values(values).returning({ id: schema.weeklySchedule.id });
    await audit(user.id, "create", "weekly_schedule", null, { kind, days, startTime, endTime, ...target, ids: created.map((c) => c.id) });
    refresh();
    return { ok: `Added ${created.length} time slot${created.length === 1 ? "" : "s"}.` };
  });
}

/** Removes a time slot on every day it repeats. */
export async function removeScheduleEntries(ids: string[]): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageSchedules);
    const db = await getDb();
    await db.delete(schema.weeklySchedule).where(inArray(schema.weeklySchedule.id, ids));
    await audit(user.id, "delete", "weekly_schedule", null, { ids });
    refresh();
    return { ok: "Removed." };
  });
}
