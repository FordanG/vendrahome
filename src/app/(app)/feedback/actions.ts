"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN, requireStaff } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { str } from "@/lib/format";
import { mutate } from "@/lib/mutations";
import type { ActionState } from "@/lib/action-state";

/** Records how a low rating was followed up, which clears its flag. */
export async function followUp(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.viewFeedback);
    const note = str(fd.get("followUp"));
    if (!note) return { error: "Say what was done, e.g. Talked to the tenant, re-cleaned the bathroom." };
    if (note.length > 1000) return { error: "Please keep it under 1,000 characters." };
    const db = await getDb();
    const [row] = await db
      .update(schema.feedback)
      .set({ followUp: note, followedUpBy: user.id, followedUpAt: new Date() })
      .where(and(eq(schema.feedback.id, id), isNull(schema.feedback.followUp)))
      .returning();
    if (!row) return { error: "Someone already followed up on this." };
    await audit(user.id, "follow_up", "feedback", id, { note });
    revalidatePath("/feedback");
    return { ok: "Saved." };
  });
}
