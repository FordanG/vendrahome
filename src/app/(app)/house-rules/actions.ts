"use server";

import { mutate } from "@/lib/mutations";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN, requireStaff } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { str } from "@/lib/format";
import type { ActionState } from "@/lib/action-state";

function readRule(fd: FormData) {
  const title = str(fd.get("title"));
  const position = Number(str(fd.get("position")) ?? 0);
  if (!title) return { error: "Give the rule a title." } as const;
  if (!Number.isInteger(position)) return { error: "Order must be a whole number." } as const;
  return { value: { title, body: str(fd.get("body")), position } } as const;
}

function refresh() {
  revalidatePath("/house-rules");
  revalidatePath("/me/rules");
}

export async function createRule(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageHouseRules);
    const rule = readRule(fd);
    if ("error" in rule) return { error: rule.error };
    const db = await getDb();
    const [created] = await db.insert(schema.houseRules).values(rule.value).returning();
    await audit(user.id, "create", "house_rule", created.id, { title: created.title });
    refresh();
    return { ok: "Rule added." };
  });
}

export async function updateRule(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageHouseRules);
    const rule = readRule(fd);
    if ("error" in rule) return { error: rule.error };
    const db = await getDb();
    await db
      .update(schema.houseRules)
      .set({ ...rule.value, updatedAt: new Date() })
      .where(eq(schema.houseRules.id, id));
    await audit(user.id, "update", "house_rule", id, rule.value);
    refresh();
    return { ok: "Saved." };
  });
}

export async function deleteRule(id: string): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageHouseRules);
    const db = await getDb();
    await db.delete(schema.houseRules).where(eq(schema.houseRules.id, id));
    await audit(user.id, "delete", "house_rule", id);
    refresh();
    return { ok: "Deleted." };
  });
}
