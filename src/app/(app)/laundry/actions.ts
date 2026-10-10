"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, ne } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN, requireStaff } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { formatPeso, manilaDate, parsePeso, str } from "@/lib/format";
import { chargeLoad, createClaim, formatKilos, laundryPrice, loadLabel, parseKilos } from "@/lib/laundry";
import { mutate } from "@/lib/mutations";
import { getCurrentStay } from "@/lib/portal";
import type { ActionState } from "@/lib/action-state";

function refresh() {
  revalidatePath("/laundry");
  revalidatePath("/me");
  revalidatePath("/me/laundry");
}

/** A tenant brought a bag to the desk. */
export async function receiveLoad(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.handleLaundry);
    const occupantId = str(fd.get("occupantId"));
    const serviceId = str(fd.get("serviceId"));
    const bags = Number(fd.get("bags") ?? 1);
    if (!occupantId) return { error: "Pick the tenant." };
    if (!Number.isInteger(bags) || bags < 1 || bags > 10) return { error: "Bags must be a whole number from 1 to 10." };
    const db = await getDb();
    const service = serviceId ? await db.query.laundryServices.findFirst({ where: eq(schema.laundryServices.id, serviceId) }) : null;
    if (!service?.active) return { error: "Pick the service." };
    const occupant = await db.query.occupants.findFirst({ where: eq(schema.occupants.id, occupantId) });
    if (!occupant) return { error: "Tenant not found." };
    const stay = await getCurrentStay(occupantId);
    if (!stay) return { error: `${occupant.fullName} doesn't live here right now.` };
    const [load] = await db
      .insert(schema.laundryLoads)
      .values({ occupantId, roomId: stay.room.id, serviceId: service.id, bags, notes: str(fd.get("notes")), receivedBy: user.id })
      .returning();
    await audit(user.id, "receive", "laundry_load", load.id, { number: load.number, occupant: occupant.fullName, bags });
    refresh();
    return { ok: `${loadLabel(load.number)} for ${occupant.fullName}, room ${stay.room.number}. Write ${load.number} on the bag tag.` };
  });
}

/** Hands the chosen bags at the desk to the shop. */
export async function sendToShop(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.handleLaundry);
    const ids = fd.getAll("loadId").map(String);
    if (ids.length === 0) return { error: "Tick the bags going to the shop." };
    const db = await getDb();
    const sent = await db
      .update(schema.laundryLoads)
      .set({ status: "at_shop", sentAt: new Date(), handledBy: user.id })
      .where(and(inArray(schema.laundryLoads.id, ids), eq(schema.laundryLoads.status, "at_desk")))
      .returning({ number: schema.laundryLoads.number });
    if (sent.length !== ids.length) return { error: "Some of these bags already moved on. Reload the page." };
    await audit(user.id, "send_to_shop", "laundry_load", null, { loads: sent.map((l) => l.number) });
    refresh();
    return { ok: `${sent.length} ${sent.length === 1 ? "load" : "loads"} sent to the shop.` };
  });
}

/** The bag came back: enter the weight from the shop's slip. Adds the charge. */
export async function recordReturn(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.handleLaundry);
    const grams = parseKilos(fd.get("kilos"));
    if (!grams) return { error: "Enter the kilos from the shop's slip, e.g. 3.5." };
    const db = await getDb();
    const load = await db.query.laundryLoads.findFirst({ where: eq(schema.laundryLoads.id, id) });
    if (!load || (load.status !== "at_shop" && load.status !== "at_desk")) return { error: "This load isn't waiting to come back. Reload the page." };
    const service = await db.query.laundryServices.findFirst({ where: eq(schema.laundryServices.id, load.serviceId) });
    if (!service) return { error: "The load's service no longer exists." };
    const { amount, cost } = laundryPrice(service, grams);
    const now = new Date();
    const charge = await chargeLoad(load, amount, manilaDate(now), user.id, `${service.name}, ${formatKilos(grams)} (${loadLabel(load.number)})`);
    await db
      .update(schema.laundryLoads)
      .set({ status: "ready", grams, amount, cost, chargeId: charge.id, returnedAt: now, sentAt: load.sentAt ?? now, handledBy: user.id })
      .where(eq(schema.laundryLoads.id, id));
    await audit(user.id, "return", "laundry_load", id, { number: load.number, grams, amount, chargeId: charge.id });
    refresh();
    return { ok: `${loadLabel(load.number)}: ${formatKilos(grams)}, ${formatPeso(amount)} charged to the ${charge.billTo === "company" ? "company" : "tenant"}.` };
  });
}

export async function markCollected(id: string): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.handleLaundry);
    const db = await getDb();
    const [load] = await db
      .update(schema.laundryLoads)
      .set({ status: "collected", collectedAt: new Date(), handledBy: user.id })
      .where(and(eq(schema.laundryLoads.id, id), eq(schema.laundryLoads.status, "ready")))
      .returning();
    if (!load) return { error: "This load isn't ready to pick up. Reload the page." };
    await audit(user.id, "collect", "laundry_load", id, { number: load.number });
    refresh();
    return { ok: "Picked up." };
  });
}

/** Cancels a load that hasn't been weighed yet, e.g. logged by mistake. */
export async function cancelLoad(id: string): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.handleLaundry);
    const db = await getDb();
    const [load] = await db
      .update(schema.laundryLoads)
      .set({ status: "cancelled", handledBy: user.id })
      .where(and(eq(schema.laundryLoads.id, id), inArray(schema.laundryLoads.status, ["at_desk", "at_shop"])))
      .returning();
    if (!load) return { error: "Only a load that hasn't come back from the shop can be cancelled." };
    await audit(user.id, "cancel", "laundry_load", id, { number: load.number });
    refresh();
    return { ok: "Cancelled." };
  });
}

/** Adds or edits a service and its rates. */
export async function saveService(id: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageLaundryRates);
    const name = str(fd.get("name"));
    const ratePerKilo = parsePeso(fd.get("ratePerKilo"));
    const costRaw = str(fd.get("costPerKilo"));
    const costPerKilo = costRaw ? parsePeso(costRaw) : null;
    const minRaw = str(fd.get("minimumCharge"));
    const minimumCharge = minRaw ? parsePeso(minRaw) : null;
    const turnaroundDays = Number(fd.get("turnaroundDays") ?? 2);
    if (!name) return { error: "Name the service, e.g. Wash, dry and fold." };
    if (!ratePerKilo) return { error: "Enter the price per kilo." };
    if (costRaw && costPerKilo == null) return { error: "Enter the shop's cost per kilo as an amount, or leave it blank." };
    if (minRaw && minimumCharge == null) return { error: "Enter the minimum charge as an amount, or leave it blank." };
    if (!Number.isInteger(turnaroundDays) || turnaroundDays < 0 || turnaroundDays > 14) return { error: "Days at the shop must be from 0 to 14." };
    const db = await getDb();
    const clash = await db.query.laundryServices.findFirst({ where: id ? and(eq(schema.laundryServices.name, name), ne(schema.laundryServices.id, id)) : eq(schema.laundryServices.name, name) });
    if (clash) return { error: `There's already a service called ${name}.` };
    const values = { name, ratePerKilo, costPerKilo, minimumCharge, turnaroundDays, active: id ? fd.get("active") === "on" : true };
    if (id) await db.update(schema.laundryServices).set(values).where(eq(schema.laundryServices.id, id));
    else await db.insert(schema.laundryServices).values(values);
    await audit(user.id, id ? "update" : "create", "laundry_service", id, values);
    revalidatePath("/laundry/settings");
    revalidatePath("/laundry");
    return { ok: id ? "Saved. New rates apply to loads weighed from now on." : `${name} added.` };
  });
}

/** Closes a claim with what was done about it. */
export async function resolveClaim(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.handleLaundry);
    const resolution = str(fd.get("resolution"));
    if (!resolution) return { error: "Say how it was settled, e.g. Shop paid ₱300, found and returned." };
    const db = await getDb();
    const [claim] = await db
      .update(schema.laundryClaims)
      .set({ status: "resolved", resolution, resolvedBy: user.id, resolvedAt: new Date() })
      .where(and(eq(schema.laundryClaims.id, id), eq(schema.laundryClaims.status, "open")))
      .returning();
    if (!claim) return { error: "This claim is already closed." };
    await audit(user.id, "resolve", "laundry_claim", id, { resolution });
    refresh();
    return { ok: "Claim closed." };
  });
}

/** The desk records a problem with a load that came back. */
export async function addClaim(loadId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.handleLaundry);
    const result = await createClaim(loadId, fd, user.id);
    if ("error" in result) return { error: result.error };
    await audit(user.id, "create", "laundry_claim", result.claim.id, { number: result.load.number, kind: result.claim.kind });
    refresh();
    return { ok: "Claim recorded." };
  });
}
