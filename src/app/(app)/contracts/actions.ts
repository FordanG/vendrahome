"use server";

import { mutate } from "@/lib/mutations";

import { revalidatePath } from "next/cache";
import { and, eq, gte, inArray, isNull, lte, ne } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN, requireStaff } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { isISODate, parsePeso, str, todayISO } from "@/lib/format";
import { contractMonths, rentSchedule } from "@/lib/rent";
import type { ActionState } from "@/lib/action-state";

type Terms = {
  clientId: string;
  reference: string;
  startDate: string;
  endDate: string;
  rentType: "total" | "per_room";
  monthlyRent: number;
  deposit: number;
  advance: number;
  billingDay: number;
  partialMonthPolicy: "full" | "prorated";
  paymentTerms: string | null;
  notes: string | null;
};

function readTerms(fd: FormData): { error: string } | { value: Terms } {
  const clientId = str(fd.get("clientId"));
  const reference = str(fd.get("reference"));
  const startDate = str(fd.get("startDate"));
  const endDate = str(fd.get("endDate"));
  const rentType = fd.get("rentType") === "per_room" ? "per_room" : "total";
  const monthlyRent = parsePeso(fd.get("monthlyRent")) ?? 0;
  const deposit = parsePeso(fd.get("deposit"));
  const advance = parsePeso(fd.get("advance"));
  const billingDay = Number(fd.get("billingDay"));
  if (!clientId) return { error: "Pick a client." };
  if (!reference) return { error: "Give the contract a reference, e.g. the contract number." };
  if (!isISODate(startDate) || !isISODate(endDate)) return { error: "Enter valid start and end dates." };
  if (endDate <= startDate) return { error: "The end date must be after the start date." };
  if (deposit === null || advance === null) return { error: "Enter the deposit and advance amounts (0 if none)." };
  if (fd.get("monthlyRent") && parsePeso(fd.get("monthlyRent")) === null) return { error: "Monthly rent isn't a valid amount." };
  if (!Number.isInteger(billingDay) || billingDay < 1 || billingDay > 28)
    return { error: "Billing day must be between 1 and 28." };
  return {
    value: {
      clientId,
      reference,
      startDate,
      endDate,
      rentType,
      monthlyRent,
      deposit,
      advance,
      billingDay,
      partialMonthPolicy: fd.get("partialMonthPolicy") === "prorated" ? "prorated" : "full",
      paymentTerms: str(fd.get("paymentTerms")),
      notes: str(fd.get("notes")),
    },
  };
}

/** Rooms among `roomIds` that are already in another active contract overlapping these dates. */
async function roomsInOtherContracts(roomIds: string[], startDate: string, endDate: string, exceptContractId?: string) {
  if (roomIds.length === 0) return [];
  const db = await getDb();
  return db
    .select({ number: schema.rooms.number, reference: schema.contracts.reference })
    .from(schema.contractRooms)
    .innerJoin(schema.contracts, eq(schema.contractRooms.contractId, schema.contracts.id))
    .innerJoin(schema.rooms, eq(schema.contractRooms.roomId, schema.rooms.id))
    .where(
      and(
        inArray(schema.contractRooms.roomId, roomIds),
        eq(schema.contracts.status, "active"),
        lte(schema.contracts.startDate, endDate),
        gte(schema.contracts.endDate, startDate),
        exceptContractId ? ne(schema.contracts.id, exceptContractId) : undefined,
      ),
    );
}

function clashMessage(clashes: { number: string; reference: string }[]) {
  const list = clashes.slice(0, 8).map((c) => `${c.number} (${c.reference})`).join(", ");
  return `These rooms are already in another active contract for these dates: ${list}${clashes.length > 8 ? "…" : ""}`;
}

export async function createContract(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageContracts);
    const parsed = readTerms(fd);
    if ("error" in parsed) return parsed;
    const db = await getDb();

    let roomIds: string[] = [];
    if (fd.get("rooms") === "all") {
      roomIds = (await db.select({ id: schema.rooms.id }).from(schema.rooms)).map((r) => r.id);
    }

    const [contract] = await db.insert(schema.contracts).values(parsed.value).returning();
    if (roomIds.length > 0) {
      await db.insert(schema.contractRooms).values(roomIds.map((roomId) => ({ contractId: contract.id, roomId })));
    }
    await audit(user.id, "create", "contract", contract.id, { ...parsed.value, rooms: roomIds.length });
    revalidatePath("/contracts");
    return { redirectTo: `/contracts/${contract.id}` };
  });
}

export async function updateContract(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageContracts);
    const parsed = readTerms(fd);
    if ("error" in parsed) return parsed;
    const db = await getDb();
    const current = await db.query.contracts.findFirst({ where: eq(schema.contracts.id, id) });
    if (!current) return { error: "Contract not found." };
    if (current.status !== "draft") {
      const changed = Object.entries(parsed.value).some(([key, value]) =>
        !["reference", "notes"].includes(key) && current[key as keyof typeof parsed.value] !== value);
      if (changed) return { error: "Activated contract terms are locked to preserve history. Create a new contract for a new term or changed terms." };
    }
    if (current.status === "active") {
      const roomIds = (
        await db.select({ id: schema.contractRooms.roomId }).from(schema.contractRooms).where(eq(schema.contractRooms.contractId, id))
      ).map((r) => r.id);
      const clashes = await roomsInOtherContracts(roomIds, parsed.value.startDate, parsed.value.endDate, id);
      if (clashes.length) return { error: clashMessage(clashes) };
    }
    await db.update(schema.contracts).set(parsed.value).where(eq(schema.contracts.id, id));
    await audit(user.id, "update", "contract", id, { before: current, after: parsed.value });
    revalidatePath(`/contracts/${id}`);
    return { ok: "Saved." };
  });
}

export async function setContractStatus(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageContracts);
    const status = String(fd.get("status"));
    if (!["draft", "active", "ended", "terminated"].includes(status)) return { error: "Unknown status." };
    const db = await getDb();
    const contract = await db.query.contracts.findFirst({ where: eq(schema.contracts.id, id) });
    if (!contract) return { error: "Contract not found." };
    if (status === contract.status) return { ok: "Status unchanged." };
    if (contract.status === "ended" || contract.status === "terminated" || status === "draft")
      return { error: "A completed or activated contract cannot be returned to draft or reactivated. Create a new contract." };
    if (contract.status === "draft" && status !== "active") return { error: "Activate the draft first." };
    if (status === "ended" || status === "terminated") {
      const open = await db.query.roomAssignments.findFirst({ where: and(eq(schema.roomAssignments.contractId, id), isNull(schema.roomAssignments.actualCheckOut)) });
      if (open) return { error: "Resolve this contract's current and reserved stays before ending it." };
      if (status === "ended" && contract.endDate >= todayISO()) return { error: "The term has not ended. Use Ended early after resolving all stays." };
    }
    if (status === "active") {
      if (contract.endDate < todayISO()) return { error: "An expired draft cannot be activated." };
      const covered = await db.query.contractRooms.findMany({ where: eq(schema.contractRooms.contractId, id) });
      if (contract.rentType === "per_room" && covered.some(r => r.monthlyRate == null || r.monthlyRate <= 0))
        return { error: "Set a positive monthly rate for every room before activating." };
      const base = contract.rentType === "per_room" ? covered.reduce((sum,r) => sum + (r.monthlyRate ?? 0), 0) : contract.monthlyRent;
      if (!Number.isSafeInteger(base) || base <= 0) return { error: "Set a positive monthly rent before activating." };
      const steps = await db.query.rentSteps.findMany({ where: eq(schema.rentSteps.contractId, id) });
      if (steps.some(s => s.startMonth > contractMonths(contract.startDate, contract.endDate))) return { error: "Remove rent changes outside the contract term." };
      try { rentSchedule(base, steps, contract.startDate, contract.endDate, contract.partialMonthPolicy); }
      catch { return { error: "The rent schedule contains an invalid or excessively large amount." }; }
      const incompatible = await db.select({ id: schema.roomAssignments.id }).from(schema.roomAssignments)
        .innerJoin(schema.occupants, eq(schema.occupants.id, schema.roomAssignments.occupantId))
        .where(and(inArray(schema.roomAssignments.roomId, covered.map(r => r.roomId)), isNull(schema.roomAssignments.actualCheckOut), ne(schema.occupants.clientId, contract.clientId)));
      if (incompatible.length) return { error: "These rooms have occupants from another company. Resolve their stays before activating." };

      const roomIds = (
        await db.select({ id: schema.contractRooms.roomId }).from(schema.contractRooms).where(eq(schema.contractRooms.contractId, id))
      ).map((r) => r.id);
      if (roomIds.length === 0) return { error: "Add rooms to the contract before activating it." };
      const clashes = await roomsInOtherContracts(roomIds, contract.startDate, contract.endDate, id);
      if (clashes.length) return { error: clashMessage(clashes) };
    }
    await db
      .update(schema.contracts)
      .set({ status: status as "draft" | "active" | "ended" | "terminated" })
      .where(eq(schema.contracts.id, id));
    await audit(user.id, "set_status", "contract", id, { from: contract.status, to: status });
    revalidatePath(`/contracts/${id}`);
    revalidatePath("/");
    return { ok: "Status updated." };
  });
}

export async function addContractRooms(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageContracts);
    const roomIds = fd.getAll("roomIds").map(String);
    if (roomIds.length === 0) return { error: "Tick at least one room." };
    const rate = fd.get("monthlyRate") ? parsePeso(fd.get("monthlyRate")) : null;
    if (fd.get("monthlyRate") && rate === null) return { error: "Rate isn't a valid amount." };
    const db = await getDb();
    const editable = await db.query.contracts.findFirst({ where: eq(schema.contracts.id, id) });
    if (!editable || editable.status !== "draft") return { error: "Rooms, rates and rent changes can only be edited on a draft. Activated terms are preserved." };
    const contract = await db.query.contracts.findFirst({ where: eq(schema.contracts.id, id) });
    if (!contract) return { error: "Contract not found." };
    if (contract.status === "active") {
      const clashes = await roomsInOtherContracts(roomIds, contract.startDate, contract.endDate, id);
      if (clashes.length) return { error: clashMessage(clashes) };
    }
    await db
      .insert(schema.contractRooms)
      .values(roomIds.map((roomId) => ({ contractId: id, roomId, monthlyRate: rate })))
      .onConflictDoNothing();
    await audit(user.id, "add_rooms", "contract", id, { rooms: roomIds.length, rate });
    revalidatePath(`/contracts/${id}`);
    revalidatePath("/");
    return { ok: `${roomIds.length} room(s) added.` };
  });
}

export async function updateContractRooms(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageContracts);
    const ids = fd.getAll("contractRoomIds").map(String);
    if (ids.length === 0) return { error: "Tick at least one room." };
    const db = await getDb();
    const editable = await db.query.contracts.findFirst({ where: eq(schema.contracts.id, id) });
    if (!editable || editable.status !== "draft") return { error: "Rooms, rates and rent changes can only be edited on a draft. Activated terms are preserved." };
    if (fd.get("intent") === "remove") {
      await db
        .delete(schema.contractRooms)
        .where(and(eq(schema.contractRooms.contractId, id), inArray(schema.contractRooms.id, ids)));
      await audit(user.id, "remove_rooms", "contract", id, { rooms: ids.length });
      revalidatePath(`/contracts/${id}`);
      revalidatePath("/");
      return { ok: `${ids.length} room(s) removed.` };
    }
    const rate = parsePeso(fd.get("monthlyRate"));
    if (rate === null) return { error: "Enter a monthly rate for the ticked rooms." };
    await db
      .update(schema.contractRooms)
      .set({ monthlyRate: rate })
      .where(and(eq(schema.contractRooms.contractId, id), inArray(schema.contractRooms.id, ids)));
    await audit(user.id, "set_room_rates", "contract", id, { rooms: ids.length, rate });
    revalidatePath(`/contracts/${id}`);
    return { ok: `Rate set for ${ids.length} room(s).` };
  });
}

export async function addRentStep(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageContracts);
    const startMonth = Number(fd.get("startMonth"));
    const kind = fd.get("kind") === "amount" ? "amount" : "percent";
    const raw = String(fd.get("value") ?? "").trim();
    if (!Number.isInteger(startMonth) || startMonth < 2) return { error: "An increase starts from month 2 or later." };
    let value: number | null;
    if (kind === "amount") {
      value = parsePeso(raw);
    } else {
      value = /^-?\d+(\.\d{1,2})?$/.test(raw) ? Math.round(Number(raw) * 100) : null;
    }
    if (value === null) return { error: kind === "amount" ? "Enter the new monthly rent." : "Enter the increase as a %, e.g. 5." };
    const db = await getDb();
    const editable = await db.query.contracts.findFirst({ where: eq(schema.contracts.id, id) });
    if (!editable || editable.status !== "draft") return { error: "Rooms, rates and rent changes can only be edited on a draft. Activated terms are preserved." };
    if (!Number.isSafeInteger(value) || (kind === "percent" && value < -10000)) return { error: "Enter a valid change; a reduction cannot exceed 100%." };
    if (startMonth > contractMonths(editable.startDate, editable.endDate)) return { error: "The change must fall within the contract term." };
    const existingSteps = await db.query.rentSteps.findMany({ where: eq(schema.rentSteps.contractId, id) });
    const roomRates = await db.query.contractRooms.findMany({ where: eq(schema.contractRooms.contractId, id) });
    const base = editable.rentType === "per_room" ? roomRates.reduce((n,r) => n + (r.monthlyRate ?? 0), 0) : editable.monthlyRent;
    try { rentSchedule(base, [...existingSteps, { startMonth, kind, value }], editable.startDate, editable.endDate); }
    catch { return { error: "This change would produce an invalid or excessively large rent." }; }
    const clash = await db.query.rentSteps.findFirst({
      where: and(eq(schema.rentSteps.contractId, id), eq(schema.rentSteps.startMonth, startMonth)),
    });
    if (clash) return { error: `There is already a change starting in month ${startMonth}. Remove it first.` };
    await db.insert(schema.rentSteps).values({ contractId: id, startMonth, kind, value, note: str(fd.get("note")) });
    await audit(user.id, "add_rent_step", "contract", id, { startMonth, kind, value });
    revalidatePath(`/contracts/${id}`);
    return { ok: "Rent change added." };
  });
}

export async function removeRentStep(contractId: string, stepId: string): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageContracts);
    const db = await getDb();
    const editable = await db.query.contracts.findFirst({ where: eq(schema.contracts.id, contractId) });
    if (!editable || editable.status !== "draft") return { error: "Rooms, rates and rent changes can only be edited on a draft. Activated terms are preserved." };
    await db
      .delete(schema.rentSteps)
      .where(and(eq(schema.rentSteps.id, stepId), eq(schema.rentSteps.contractId, contractId)));
    await audit(user.id, "remove_rent_step", "contract", contractId, { stepId });
    revalidatePath(`/contracts/${contractId}`);
    return { ok: "Removed." };
  });
}
