"use server";

import { mutate } from "@/lib/mutations";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireTenant, signOut } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { isISODate, str, todayISO } from "@/lib/format";
import { getCurrentStay } from "@/lib/portal";
import { createClaim } from "@/lib/laundry";
import { savePhoto } from "@/lib/photos";
import type { ActionState } from "@/lib/action-state";
import type { TenantRequest } from "@/db/schema";

const KINDS: TenantRequest["kind"][] = ["issue", "maintenance", "laundry"];

export async function logout() {
  await signOut();
  redirect("/login");
}

export async function createRequest(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const { user, occupant } = await requireTenant();
    const kind = String(fd.get("kind")) as TenantRequest["kind"];
    const details = str(fd.get("details"));
    const preferredDate = str(fd.get("preferredDate"));
    if (!KINDS.includes(kind)) return { error: "Pick what kind of request this is." };
    if (!details) return { error: "Tell us what you need." };
    if (details.length > 2000) return { error: "Please keep it under 2,000 characters." };
    if (preferredDate && (!isISODate(preferredDate) || preferredDate < todayISO()))
      return { error: "The date must be today or later." };
    if (kind !== "issue" && !preferredDate) return { error: "Pick the date you'd like." };

    const stay = await getCurrentStay(occupant.id);
    if (!stay) return { error: "You don't have a room right now. Please talk to the front desk." };

    const db = await getDb();
    // A problem in a shared space, reported from its door code.
    const areaId = str(fd.get("areaId"));
    const area = areaId ? await db.query.areas.findFirst({ where: and(eq(schema.areas.id, areaId), eq(schema.areas.active, true)) }) : null;
    if (areaId && !area) return { error: "That place can't take reports any more. Please tell the front desk." };
    if (area && kind !== "issue") return { error: "Only problems can be reported for a shared space." };
    const photo = await savePhoto("request", fd.get("photo"), user.id);
    if (photo && "error" in photo) return { error: photo.error };
    const [created] = await db
      .insert(schema.tenantRequests)
      .values({
        occupantId: occupant.id,
        roomId: area ? null : stay.room.id,
        areaId: area?.id ?? null,
        photoId: photo?.id ?? null,
        kind,
        details,
        urgent: fd.get("urgent") === "on",
        preferredDate,
        preferredTime: str(fd.get("preferredTime")),
      })
      .returning();
    await audit(user.id, "create", "tenant_request", created.id, { kind, room: area ? null : stay.room.number, area: area?.name });
    revalidatePath("/me");
    revalidatePath("/me/requests");
    revalidatePath("/requests");
    return { ok: kind === "issue" ? "Sent. The front desk will look into it." : "Sent. We'll let you know if it's approved." };
  });
}

/** Tenants can withdraw a request until staff act on it. */
export async function cancelRequest(id: string): Promise<ActionState> {
  return mutate(async () => {
    const { user, occupant } = await requireTenant();
    const db = await getDb();
    const updated = await db.update(schema.tenantRequests)
      .set({ status: "declined", cancelledAt: new Date(), response: "Withdrawn by tenant." })
      .where(and(eq(schema.tenantRequests.id, id), eq(schema.tenantRequests.occupantId, occupant.id), eq(schema.tenantRequests.status, "pending")))
      .returning({ id: schema.tenantRequests.id });
    if (updated.length === 0) return { error: "This request can no longer be cancelled." };
    await audit(user.id, "cancel", "tenant_request", id);
    revalidatePath("/me");
    revalidatePath("/me/requests");
    revalidatePath("/requests");
    return { ok: "Cancelled." };
  });
}

/** A tenant reports clothes missing or damaged from a load that came back. */
export async function reportLaundryClaim(loadId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const { user, occupant } = await requireTenant();
    const result = await createClaim(loadId, fd, user.id, occupant.id);
    if ("error" in result) return { error: result.error };
    await audit(user.id, "create", "laundry_claim", result.claim.id, { number: result.load.number, kind: result.claim.kind });
    revalidatePath("/me/laundry");
    revalidatePath("/laundry");
    return { ok: "Sent. The front desk will follow up with the shop." };
  });
}
