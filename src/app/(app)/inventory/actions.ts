"use server";

import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { InventoryCheckKind, ItemCategory, ItemCondition } from "@/db/schema";
import { CAN, requireStaff } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { mutate } from "@/lib/mutations";
import { addDaysISO, formatDate, formatPeso, isISODate, parsePeso, str, todayISO } from "@/lib/format";
import { savePhoto } from "@/lib/photos";
import { billToFor, chargeTypeByCode, companyAccount } from "@/lib/billing";
import { CATEGORY_LABELS, CHECK_KIND_LABELS, CONDITION_LABELS, checkDifferences, itemsIn } from "@/lib/inventory";
import type { ActionState } from "@/lib/action-state";

const CATEGORIES = Object.keys(CATEGORY_LABELS) as ItemCategory[];
const CONDITIONS = Object.keys(CONDITION_LABELS) as ItemCondition[];
const CHECK_KINDS = Object.keys(CHECK_KIND_LABELS) as InventoryCheckKind[];

function wholeNumber(v: FormDataEntryValue | null, min: number, max: number): number | null {
  const n = Number(v);
  return typeof v === "string" && v.trim() !== "" && Number.isInteger(n) && n >= min && n <= max ? n : null;
}

type ItemValues = {
  name: string; category: ItemCategory; quantity: number; brand: string | null; model: string | null; serialNumber: string | null;
  tagCode: string | null; purchaseDate: string | null; purchaseCost: number | null; replacementCost: number;
  serviceEveryMonths: number | null; lastServicedOn: string | null; notes: string | null;
};

function readItem(fd: FormData): { error: string } | { value: ItemValues } {
  const name = str(fd.get("name"));
  const category = String(fd.get("category")) as ItemCategory;
  const quantity = wholeNumber(fd.get("quantity"), 1, 999);
  const replacementCost = parsePeso(fd.get("replacementCost")) ?? (str(fd.get("replacementCost")) ? null : 0);
  const purchaseCost = str(fd.get("purchaseCost")) ? parsePeso(fd.get("purchaseCost")) : null;
  const purchaseDate = str(fd.get("purchaseDate"));
  const lastServicedOn = str(fd.get("lastServicedOn"));
  const service = str(fd.get("serviceEveryMonths"));
  const serviceEveryMonths = service ? wholeNumber(service, 1, 120) : null;
  if (!name) return { error: "Name the item, e.g. Aircon." };
  if (!CATEGORIES.includes(category)) return { error: "Pick what kind of item it is." };
  if (quantity === null) return { error: "Quantity must be a whole number from 1 to 999." };
  if (replacementCost === null) return { error: "Replacement cost isn't a valid amount." };
  if (str(fd.get("purchaseCost")) && purchaseCost === null) return { error: "Purchase cost isn't a valid amount." };
  if (purchaseDate && (!isISODate(purchaseDate) || purchaseDate > todayISO())) return { error: "The purchase date must be today or earlier." };
  if (lastServicedOn && (!isISODate(lastServicedOn) || lastServicedOn > todayISO())) return { error: "The last service date must be today or earlier." };
  if (service && serviceEveryMonths === null) return { error: "Service every: a number of months from 1 to 120, or leave it blank." };
  return {
    value: {
      name, category, quantity, replacementCost, purchaseCost, purchaseDate, lastServicedOn, serviceEveryMonths,
      brand: str(fd.get("brand")), model: str(fd.get("model")), serialNumber: str(fd.get("serialNumber")),
      tagCode: str(fd.get("tagCode"))?.toUpperCase() ?? null, notes: str(fd.get("notes")),
    },
  };
}

async function tagTaken(tagCode: string | null, exceptId?: string) {
  if (!tagCode) return false;
  const db = await getDb();
  const other = await db.query.roomItems.findFirst({ where: eq(schema.roomItems.tagCode, tagCode) });
  return !!other && other.id !== exceptId;
}

/** Adds an item to a room, or to the storeroom when roomId is null. */
export async function addItem(roomId: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageInventory);
    const parsed = readItem(fd);
    if ("error" in parsed) return parsed;
    const db = await getDb();
    if (roomId && !(await db.query.rooms.findFirst({ where: eq(schema.rooms.id, roomId) }))) return { error: "Room not found." };
    if (await tagTaken(parsed.value.tagCode)) return { error: `Tag ${parsed.value.tagCode} is already on another item.` };
    const photo = await savePhoto("inventory", fd.get("photo"), user.id);
    if (photo && "error" in photo) return photo;
    const [item] = await db.insert(schema.roomItems).values({ ...parsed.value, roomId, photoId: photo?.id ?? null }).returning();
    await db.insert(schema.itemEvents).values({ itemId: item.id, kind: "added", toRoomId: roomId, condition: item.condition, staffId: user.id });
    await audit(user.id, "create", "room_item", item.id, { ...item });
    return { ok: `${item.name} added.` };
  });
}

export async function updateItem(itemId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageInventory);
    const parsed = readItem(fd);
    if ("error" in parsed) return parsed;
    const db = await getDb();
    const before = await db.query.roomItems.findFirst({ where: eq(schema.roomItems.id, itemId) });
    if (!before || before.retiredOn) return { error: "Item not found." };
    if (await tagTaken(parsed.value.tagCode, itemId)) return { error: `Tag ${parsed.value.tagCode} is already on another item.` };
    const photo = await savePhoto("inventory", fd.get("photo"), user.id);
    if (photo && "error" in photo) return photo;
    await db.update(schema.roomItems).set({ ...parsed.value, ...(photo ? { photoId: photo.id } : {}) }).where(eq(schema.roomItems.id, itemId));
    await db.insert(schema.itemEvents).values({ itemId, kind: "updated", staffId: user.id });
    await audit(user.id, "update", "room_item", itemId, { before, after: parsed.value });
    return { ok: "Saved." };
  });
}

/**
 * A quick spot check of one item. A damaged or missing item can become a repair
 * visit in the same step, so maintenance sees it on their list.
 */
export async function setItemCondition(itemId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.viewInventory);
    const db = await getDb();
    const item = await db.query.roomItems.findFirst({ where: eq(schema.roomItems.id, itemId) });
    if (!item || item.retiredOn) return { error: "Item not found." };
    const condition = String(fd.get("condition")) as ItemCondition;
    if (!CONDITIONS.includes(condition)) return { error: "Pick the item's condition." };
    const note = str(fd.get("note"));
    const repair = fd.get("repair") === "on";
    if (repair && !item.roomId) return { error: "Items in the storeroom can't get a room repair visit." };
    if (repair && condition === "good") return { error: "A repair visit is for items that are damaged or worn." };
    const repairDate = str(fd.get("repairDate")) ?? addDaysISO(todayISO(), 1);
    if (repair && (!isISODate(repairDate) || repairDate < todayISO())) return { error: "The repair date must be today or later." };
    await db.update(schema.roomItems).set({ condition }).where(eq(schema.roomItems.id, itemId));
    await db.insert(schema.itemEvents).values({ itemId, kind: "condition", condition, note, staffId: user.id });
    if (repair) {
      const [visit] = await db.insert(schema.maintenanceVisits).values({
        roomId: item.roomId!,
        title: `Repair: ${item.name}`,
        date: repairDate,
        notes: [`${CONDITION_LABELS[condition]}.`, note].filter(Boolean).join(" "),
        createdBy: user.id,
      }).returning();
      await audit(user.id, "create", "visit", visit.id, { fromItem: itemId, title: visit.title, date: visit.date });
    }
    await audit(user.id, "condition", "room_item", itemId, { from: item.condition, to: condition, note, repair });
    return { ok: repair ? "Saved, and a repair visit was booked." : "Saved." };
  });
}

export async function markServiced(itemId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.viewInventory);
    const db = await getDb();
    const item = await db.query.roomItems.findFirst({ where: eq(schema.roomItems.id, itemId) });
    if (!item || item.retiredOn) return { error: "Item not found." };
    const date = str(fd.get("date")) ?? todayISO();
    if (!isISODate(date) || date > todayISO()) return { error: "The service date must be today or earlier." };
    const note = str(fd.get("note"));
    await db.update(schema.roomItems).set({ lastServicedOn: date }).where(eq(schema.roomItems.id, itemId));
    await db.insert(schema.itemEvents).values({ itemId, kind: "serviced", note: [date, note].filter(Boolean).join(": "), staffId: user.id });
    await audit(user.id, "serviced", "room_item", itemId, { date, note });
    return { ok: "Service recorded." };
  });
}

/** Moves an item to another room, or to the storeroom. */
export async function moveItem(itemId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageInventory);
    const db = await getDb();
    const item = await db.query.roomItems.findFirst({ where: eq(schema.roomItems.id, itemId) });
    if (!item || item.retiredOn) return { error: "Item not found." };
    const to = str(fd.get("toRoomId"));
    const toRoomId = to === "storeroom" ? null : to;
    if (toRoomId && !(await db.query.rooms.findFirst({ where: eq(schema.rooms.id, toRoomId) }))) return { error: "Pick where it's going." };
    if (toRoomId === item.roomId) return { error: "It's already there." };
    const note = str(fd.get("note"));
    await db.update(schema.roomItems).set({ roomId: toRoomId }).where(eq(schema.roomItems.id, itemId));
    await db.insert(schema.itemEvents).values({ itemId, kind: "moved", fromRoomId: item.roomId, toRoomId, note, staffId: user.id });
    await audit(user.id, "move", "room_item", itemId, { from: item.roomId, to: toRoomId, note });
    return { ok: "Moved." };
  });
}

/** Takes an item out of use (thrown away, sold, beyond repair). Its history stays. */
export async function retireItem(itemId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageInventory);
    const db = await getDb();
    const item = await db.query.roomItems.findFirst({ where: eq(schema.roomItems.id, itemId) });
    if (!item || item.retiredOn) return { error: "Item not found." };
    const reason = str(fd.get("reason"));
    if (!reason) return { error: "Say why, e.g. \"Beyond repair\"." };
    await db.update(schema.roomItems).set({ retiredOn: todayISO() }).where(eq(schema.roomItems.id, itemId));
    await db.insert(schema.itemEvents).values({ itemId, kind: "retired", fromRoomId: item.roomId, note: reason, staffId: user.id });
    await audit(user.id, "retire", "room_item", itemId, { reason });
    return { ok: "Removed from the inventory.", redirectTo: item.roomId ? `/inventory/rooms/${item.roomId}` : "/inventory/rooms/storeroom" };
  });
}

/**
 * Saves a check of every item in the room. Each item's condition is updated to
 * what was found, and the check is kept so later checks can be compared with it.
 */
export async function recordCheck(roomId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.viewInventory);
    const db = await getDb();
    const room = await db.query.rooms.findFirst({ where: eq(schema.rooms.id, roomId) });
    if (!room) return { error: "Room not found." };
    const kind = String(fd.get("kind")) as InventoryCheckKind;
    if (!CHECK_KINDS.includes(kind)) return { error: "Pick what kind of check this is." };
    const checkedOn = str(fd.get("checkedOn")) ?? todayISO();
    if (!isISODate(checkedOn) || checkedOn > todayISO()) return { error: "The check date must be today or earlier." };

    let assignmentId: string | null = null;
    let contractId: string | null = null;
    if (kind === "move_in" || kind === "move_out") {
      assignmentId = str(fd.get("assignmentId"));
      const stay = assignmentId ? await db.query.roomAssignments.findFirst({ where: eq(schema.roomAssignments.id, assignmentId) }) : null;
      if (!stay || stay.roomId !== roomId) return { error: `Pick whose ${kind === "move_in" ? "move-in" : "move-out"} this is.` };
      contractId = stay.contractId;
    } else {
      const covering = await db
        .select({ id: schema.contracts.id })
        .from(schema.contractRooms)
        .innerJoin(schema.contracts, eq(schema.contractRooms.contractId, schema.contracts.id))
        .where(and(eq(schema.contractRooms.roomId, roomId), eq(schema.contracts.status, "active")));
      contractId = str(fd.get("contractId")) ?? covering[0]?.id ?? null;
      if ((kind === "contract_start" || kind === "handover") && !contractId) return { error: "This room isn't under an active contract." };
    }

    const items = await itemsIn(roomId);
    if (items.length === 0) return { error: "This room has no items yet. Add them first, or set up the room type's standard list." };
    const lines: { itemId: string; found: number; condition: ItemCondition; note: string | null; photoId: string | null }[] = [];
    for (const item of items) {
      const found = wholeNumber(fd.get(`found_${item.id}`), 0, item.quantity);
      let condition = String(fd.get(`condition_${item.id}`)) as ItemCondition;
      if (found === null) return { error: `${item.name}: enter how many were found, from 0 to ${item.quantity}.` };
      if (!CONDITIONS.includes(condition)) return { error: `${item.name}: pick its condition.` };
      if (found === 0) condition = "missing";
      if (condition === "missing" && found > 0) return { error: `${item.name}: marked missing but ${found} found. Set the number found to 0, or pick another condition.` };
      const photo = await savePhoto("inventory", fd.get(`photo_${item.id}`), user.id);
      if (photo && "error" in photo) return { error: `${item.name}: ${photo.error}` };
      lines.push({ itemId: item.id, found, condition, note: str(fd.get(`note_${item.id}`)), photoId: photo?.id ?? null });
    }

    const [check] = await db.insert(schema.inventoryChecks).values({
      roomId, kind, contractId, assignmentId, checkedOn, checkedBy: user.id, signedBy: str(fd.get("signedBy")), notes: str(fd.get("notes")),
    }).returning();
    await db.insert(schema.inventoryCheckLines).values(lines.map((l) => ({ ...l, checkId: check.id })));
    for (const l of lines) {
      const item = items.find((i) => i.id === l.itemId)!;
      if (item.condition !== l.condition) {
        await db.update(schema.roomItems).set({ condition: l.condition }).where(eq(schema.roomItems.id, l.itemId));
        await db.insert(schema.itemEvents).values({ itemId: l.itemId, kind: "condition", condition: l.condition, note: l.note, checkId: check.id, staffId: user.id });
      }
    }
    await audit(user.id, "check", "inventory_check", check.id, { room: room.number, kind, items: lines.length });
    return { redirectTo: `/inventory/checks/${check.id}` };
  });
}

async function findDifference(checkId: string, lineId: string) {
  const db = await getDb();
  const check = await db.query.inventoryChecks.findFirst({ where: eq(schema.inventoryChecks.id, checkId) });
  if (!check) return null;
  const { differences } = await checkDifferences(check);
  const diff = differences.find((d) => d.line.id === lineId);
  return diff ? { check, diff } : null;
}

/** Charges a difference found at move-out (or another check) as damage or missing items. */
export async function chargeDifference(checkId: string, lineId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.recordBilling);
    const db = await getDb();
    const found = await findDifference(checkId, lineId);
    if (!found) return { error: "Nothing to charge for this item." };
    const { check, diff } = found;
    if (diff.line.chargeId || diff.line.depositEntryId) return { error: "This was already charged or deducted." };
    const amount = parsePeso(fd.get("amount"));
    if (!amount) return { error: "Enter an amount greater than ₱0." };
    const stay = check.assignmentId ? await db.query.roomAssignments.findFirst({ where: eq(schema.roomAssignments.id, check.assignmentId) }) : null;
    const contractId = check.contractId ?? stay?.contractId ?? null;
    const damage = await chargeTypeByCode("damage");
    const choice = fd.get("billTo");
    const billTo = choice === "company" || choice === "occupant" ? choice : await billToFor(contractId, damage.id);
    if (billTo === "occupant" && !stay) return { error: "This check isn't for a tenant's stay. Bill the company instead." };
    if (billTo === "company" && !contractId) return { error: "This room had no contract at the time. Bill the tenant instead." };
    const what = diff.missing ? `${diff.missing} × ${diff.item.name} missing` : `${diff.item.name} ${CONDITION_LABELS[diff.line.condition].toLowerCase()}`;
    const [charge] = await db.insert(schema.charges).values({
      chargeTypeId: damage.id,
      billTo,
      contractId,
      occupantId: stay?.occupantId ?? null,
      roomId: check.roomId,
      description: `${what} (${CHECK_KIND_LABELS[check.kind].toLowerCase()}, ${formatDate(check.checkedOn)})`,
      amount,
      chargedOn: todayISO(),
      createdBy: user.id,
    }).returning();
    await db.update(schema.inventoryCheckLines).set({ chargeId: charge.id }).where(eq(schema.inventoryCheckLines.id, lineId));
    await audit(user.id, "charge", "charge", charge.id, { ...charge, fromCheck: checkId });
    return { ok: billTo === "company" ? "Charged to the company's next statement." : "Charged to the tenant." };
  });
}

/** At handover: takes the cost of a damaged or missing item out of the deposit. */
export async function deductDifference(checkId: string, lineId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageBilling);
    const db = await getDb();
    const found = await findDifference(checkId, lineId);
    if (!found) return { error: "Nothing to deduct for this item." };
    const { check, diff } = found;
    if (diff.line.chargeId || diff.line.depositEntryId) return { error: "This was already charged or deducted." };
    if (!check.contractId) return { error: "This check isn't linked to a contract." };
    const amount = parsePeso(fd.get("amount"));
    if (!amount) return { error: "Enter an amount greater than ₱0." };
    const { deposit } = await companyAccount(check.contractId, todayISO());
    if (amount > deposit.held) return { error: `Only ${formatPeso(deposit.held)} of the deposit is left.` };
    const what = diff.missing ? `${diff.missing} × ${diff.item.name} missing` : `${diff.item.name} ${CONDITION_LABELS[diff.line.condition].toLowerCase()}`;
    const room = await db.query.rooms.findFirst({ where: eq(schema.rooms.id, check.roomId) });
    const [entry] = await db.insert(schema.depositEntries).values({
      contractId: check.contractId,
      kind: "deduction",
      amount,
      entryOn: todayISO(),
      description: `Room ${room?.number}: ${what}`,
      roomItemId: diff.item.id,
      checkId,
      createdBy: user.id,
    }).returning();
    await db.update(schema.inventoryCheckLines).set({ depositEntryId: entry.id }).where(eq(schema.inventoryCheckLines.id, lineId));
    await audit(user.id, "deposit_deduction", "deposit", entry.id, { ...entry });
    return { ok: "Deducted from the deposit." };
  });
}

export async function saveTemplate(roomTypeId: string, templateId: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageRooms);
    const db = await getDb();
    if (!(await db.query.roomTypes.findFirst({ where: eq(schema.roomTypes.id, roomTypeId) }))) return { error: "Room type not found." };
    const name = str(fd.get("name"));
    const category = String(fd.get("category")) as ItemCategory;
    const quantity = wholeNumber(fd.get("quantity"), 1, 999);
    const replacementCost = parsePeso(fd.get("replacementCost")) ?? (str(fd.get("replacementCost")) ? null : 0);
    const service = str(fd.get("serviceEveryMonths"));
    const serviceEveryMonths = service ? wholeNumber(service, 1, 120) : null;
    if (!name) return { error: "Name the item." };
    if (!CATEGORIES.includes(category)) return { error: "Pick what kind of item it is." };
    if (quantity === null) return { error: "Quantity must be a whole number from 1 to 999." };
    if (replacementCost === null) return { error: "Replacement cost isn't a valid amount." };
    if (service && serviceEveryMonths === null) return { error: "Service every: a number of months from 1 to 120, or leave it blank." };
    const values = { name, category, quantity, replacementCost, serviceEveryMonths };
    if (templateId) {
      await db.update(schema.itemTemplates).set(values).where(and(eq(schema.itemTemplates.id, templateId), eq(schema.itemTemplates.roomTypeId, roomTypeId)));
    } else {
      await db.insert(schema.itemTemplates).values({ ...values, roomTypeId, position: 100 });
    }
    await audit(user.id, templateId ? "update" : "create", "item_template", templateId ?? roomTypeId, values);
    return { ok: "Saved." };
  });
}

export async function removeTemplate(roomTypeId: string, templateId: string): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageRooms);
    const db = await getDb();
    await db.delete(schema.itemTemplates).where(and(eq(schema.itemTemplates.id, templateId), eq(schema.itemTemplates.roomTypeId, roomTypeId)));
    await audit(user.id, "delete", "item_template", templateId, { roomTypeId });
    return { ok: "Removed from the list." };
  });
}

/** Adds the standard list to every room of the type, skipping items a room already has by name. */
export async function applyTemplates(roomTypeId: string): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageRooms);
    const db = await getDb();
    const templates = await db.select().from(schema.itemTemplates).where(eq(schema.itemTemplates.roomTypeId, roomTypeId)).orderBy(asc(schema.itemTemplates.position));
    if (templates.length === 0) return { error: "Add items to the standard list first." };
    const rooms = await db.select().from(schema.rooms).where(eq(schema.rooms.roomTypeId, roomTypeId));
    if (rooms.length === 0) return { error: "No rooms have this type yet." };
    let added = 0;
    for (const room of rooms) {
      const have = new Set((await db.select({ name: schema.roomItems.name }).from(schema.roomItems)
        .where(and(eq(schema.roomItems.roomId, room.id), isNull(schema.roomItems.retiredOn)))).map((r) => r.name.toLowerCase()));
      const missing = templates.filter((t) => !have.has(t.name.toLowerCase()));
      if (missing.length === 0) continue;
      const items = await db.insert(schema.roomItems).values(missing.map((t) => ({
        roomId: room.id, name: t.name, category: t.category, quantity: t.quantity, replacementCost: t.replacementCost, serviceEveryMonths: t.serviceEveryMonths,
      }))).returning({ id: schema.roomItems.id });
      await db.insert(schema.itemEvents).values(items.map((i) => ({ itemId: i.id, kind: "added" as const, toRoomId: room.id, condition: "good" as const, note: "From the standard list", staffId: user.id })));
      added += items.length;
    }
    await audit(user.id, "apply_templates", "room_type", roomTypeId, { rooms: rooms.length, added });
    return { ok: added ? `Added ${added} items across ${rooms.length} rooms.` : "Every room already has everything on the list." };
  });
}
