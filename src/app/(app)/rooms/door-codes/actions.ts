"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN, requireStaff } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { str } from "@/lib/format";
import { mutate } from "@/lib/mutations";
import { newRoomToken } from "@/lib/room-qr";
import type { ActionState } from "@/lib/action-state";

function readArea(fd: FormData) {
  const name = str(fd.get("name"));
  const floorRaw = str(fd.get("floor"));
  const floor = floorRaw == null ? null : Number(floorRaw);
  if (!name) return { error: "Give the place a name, e.g. Kitchen, 2nd floor." } as const;
  if (name.length > 80) return { error: "Keep the name under 80 characters." } as const;
  if (floor !== null && !Number.isInteger(floor)) return { error: "Floor must be a whole number, or blank." } as const;
  return { value: { name, floor } } as const;
}

export async function addArea(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageAreas);
    const parsed = readArea(fd);
    if ("error" in parsed) return { error: parsed.error };
    const db = await getDb();
    if (await db.query.areas.findFirst({ where: eq(schema.areas.name, parsed.value.name) })) return { error: `There's already a place called ${parsed.value.name}.` };
    const [area] = await db.insert(schema.areas).values({ ...parsed.value, qrToken: newRoomToken() }).returning();
    await audit(user.id, "create", "area", area.id, parsed.value);
    revalidatePath("/rooms/door-codes");
    return { ok: `${area.name} added. Print its code below.` };
  });
}

export async function updateArea(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageAreas);
    const parsed = readArea(fd);
    if ("error" in parsed) return { error: parsed.error };
    const active = fd.get("active") === "on";
    const db = await getDb();
    if (await db.query.areas.findFirst({ where: and(eq(schema.areas.name, parsed.value.name), ne(schema.areas.id, id)) })) return { error: `There's already a place called ${parsed.value.name}.` };
    const newCode = fd.get("newCode") === "on";
    const [area] = await db
      .update(schema.areas)
      .set({ ...parsed.value, active, ...(newCode ? { qrToken: newRoomToken() } : {}) })
      .where(eq(schema.areas.id, id))
      .returning();
    if (!area) return { error: "Not found." };
    await audit(user.id, "update", "area", id, { ...parsed.value, active, newCode });
    revalidatePath("/rooms/door-codes");
    return { ok: newCode ? "Saved with a new code. Print it; the old one no longer works." : "Saved." };
  });
}
