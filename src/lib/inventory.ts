import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, ne, or } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { InventoryCheck, InventoryCheckKind, ItemCategory, ItemCondition, RoomItem } from "@/db/schema";
import { addDaysISO, addMonthsISO } from "./format";

export const CONDITION_LABELS: Record<ItemCondition, string> = {
  good: "Good",
  fair: "Fair (worn)",
  damaged: "Damaged",
  missing: "Missing",
};

export const CONDITION_TONES = { good: "green", fair: "gray", damaged: "amber", missing: "red" } as const;

export const CATEGORY_LABELS: Record<ItemCategory, string> = {
  furniture: "Furniture",
  appliance: "Appliances",
  fixture: "Fixtures",
  issued: "Handed to tenants",
};

export const CHECK_KIND_LABELS: Record<InventoryCheckKind, string> = {
  contract_start: "Contract-start check",
  move_in: "Move-in check",
  move_out: "Move-out check",
  spot: "Spot check",
  handover: "Handover check",
};

const RANK: Record<ItemCondition, number> = { good: 0, fair: 1, damaged: 2, missing: 3 };
export const isWorse = (after: ItemCondition, before: ItemCondition) => RANK[after] > RANK[before];

/** Items in a room (or the hotel's storeroom when roomId is null) that haven't been retired. */
export async function itemsIn(roomId: string | null, hotelId?: string) {
  const db = await getDb();
  return db
    .select()
    .from(schema.roomItems)
    .where(
      and(
        roomId ? eq(schema.roomItems.roomId, roomId) : and(isNull(schema.roomItems.roomId), eq(schema.roomItems.propertyId, hotelId ?? "")),
        isNull(schema.roomItems.retiredOn),
      ),
    )
    .orderBy(asc(schema.roomItems.category), asc(schema.roomItems.name));
}

/** When an item is next due for service (e.g. aircon cleaning), or null if it has no service cycle. */
export function nextServiceDate(item: Pick<RoomItem, "serviceEveryMonths" | "lastServicedOn" | "purchaseDate" | "createdAt">): string | null {
  if (!item.serviceEveryMonths) return null;
  const from = item.lastServicedOn ?? item.purchaseDate ?? item.createdAt.toISOString().slice(0, 10);
  return addMonthsISO(from, item.serviceEveryMonths);
}

/**
 * The earlier check a new check is compared with:
 * - move-out: the same stay's move-in check, or the last check on or before the move-in day;
 * - handover: the contract-start check, or the first check during the contract;
 * - anything else: the room's previous check.
 */
export async function baselineFor(check: InventoryCheck): Promise<InventoryCheck | null> {
  const db = await getDb();
  const room = eq(schema.inventoryChecks.roomId, check.roomId);
  const notThis = ne(schema.inventoryChecks.id, check.id);
  if (check.kind === "move_out" && check.assignmentId) {
    const moveIn = await db.query.inventoryChecks.findFirst({
      where: and(room, notThis, eq(schema.inventoryChecks.assignmentId, check.assignmentId), eq(schema.inventoryChecks.kind, "move_in")),
      orderBy: desc(schema.inventoryChecks.checkedOn),
    });
    if (moveIn) return moveIn;
    const stay = await db.query.roomAssignments.findFirst({ where: eq(schema.roomAssignments.id, check.assignmentId) });
    if (stay) {
      return (await db.query.inventoryChecks.findFirst({
        where: and(room, notThis, lte(schema.inventoryChecks.checkedOn, stay.checkIn)),
        orderBy: [desc(schema.inventoryChecks.checkedOn), desc(schema.inventoryChecks.createdAt)],
      })) ?? null;
    }
  }
  if (check.kind === "handover" && check.contractId) {
    const start = await db.query.inventoryChecks.findFirst({
      where: and(room, notThis, eq(schema.inventoryChecks.contractId, check.contractId), eq(schema.inventoryChecks.kind, "contract_start")),
      orderBy: asc(schema.inventoryChecks.checkedOn),
    });
    if (start) return start;
    const contract = await db.query.contracts.findFirst({ where: eq(schema.contracts.id, check.contractId) });
    if (contract) {
      return (await db.query.inventoryChecks.findFirst({
        where: and(room, notThis, gte(schema.inventoryChecks.checkedOn, contract.startDate), lte(schema.inventoryChecks.checkedOn, check.checkedOn)),
        orderBy: [asc(schema.inventoryChecks.checkedOn), asc(schema.inventoryChecks.createdAt)],
      })) ?? null;
    }
  }
  return (await db.query.inventoryChecks.findFirst({
    where: and(room, notThis, or(lt(schema.inventoryChecks.checkedOn, check.checkedOn),
      and(eq(schema.inventoryChecks.checkedOn, check.checkedOn), lt(schema.inventoryChecks.createdAt, check.createdAt)))),
    orderBy: [desc(schema.inventoryChecks.checkedOn), desc(schema.inventoryChecks.createdAt)],
  })) ?? null;
}

export type CheckDifference = Awaited<ReturnType<typeof checkDifferences>>["differences"][number];

/**
 * What got worse between the baseline check and this one: fewer found, or a worse condition.
 * The suggested amount is the replacement cost of what's missing, or of one unit when damaged.
 */
export async function checkDifferences(check: InventoryCheck) {
  const db = await getDb();
  const baseline = await baselineFor(check);
  const lines = await db
    .select({ line: schema.inventoryCheckLines, item: schema.roomItems })
    .from(schema.inventoryCheckLines)
    .innerJoin(schema.roomItems, eq(schema.inventoryCheckLines.itemId, schema.roomItems.id))
    .where(eq(schema.inventoryCheckLines.checkId, check.id))
    .orderBy(asc(schema.roomItems.category), asc(schema.roomItems.name));
  const before = baseline
    ? new Map((await db.select().from(schema.inventoryCheckLines).where(eq(schema.inventoryCheckLines.checkId, baseline.id))).map((l) => [l.itemId, l]))
    : new Map<string, typeof schema.inventoryCheckLines.$inferSelect>();
  const differences = lines.flatMap(({ line, item }) => {
    const earlier = before.get(item.id);
    if (!earlier) return [];
    const missing = Math.max(earlier.found - line.found, 0);
    const worse = isWorse(line.condition, earlier.condition) && line.condition !== "missing";
    if (!missing && !worse) return [];
    const suggested = item.replacementCost * (missing || 1);
    return [{ line, item, earlier, missing, worse, suggested }];
  });
  return { baseline, lines, differences };
}

/** Rooms covered by an active contract that have no contract-start check yet. */
export async function roomsWithoutStartCheck(hotelId: string) {
  const db = await getDb();
  const covered = await db
    .select({ roomId: schema.contractRooms.roomId, contractId: schema.contracts.id, number: schema.rooms.number, floor: schema.rooms.floor })
    .from(schema.contractRooms)
    .innerJoin(schema.contracts, eq(schema.contractRooms.contractId, schema.contracts.id))
    .innerJoin(schema.rooms, eq(schema.contractRooms.roomId, schema.rooms.id))
    .where(and(eq(schema.contracts.status, "active"), eq(schema.contracts.propertyId, hotelId)))
    .orderBy(asc(schema.rooms.floor), asc(schema.rooms.number));
  if (covered.length === 0) return [];
  const done = await db
    .select({ roomId: schema.inventoryChecks.roomId, contractId: schema.inventoryChecks.contractId })
    .from(schema.inventoryChecks)
    .where(and(eq(schema.inventoryChecks.kind, "contract_start"), inArray(schema.inventoryChecks.contractId, [...new Set(covered.map((c) => c.contractId))])));
  const key = (r: { roomId: string; contractId: string | null }) => `${r.roomId}:${r.contractId}`;
  const doneKeys = new Set(done.map(key));
  return covered.filter((c) => !doneKeys.has(key(c)));
}

/** Everything that needs someone's attention, for the inventory overview. */
export async function inventoryAttention(today: string, hotelId: string) {
  const db = await getDb();
  const live = await db
    .select({ item: schema.roomItems, roomNumber: schema.rooms.number, floor: schema.rooms.floor })
    .from(schema.roomItems)
    .leftJoin(schema.rooms, eq(schema.roomItems.roomId, schema.rooms.id))
    .where(and(eq(schema.roomItems.propertyId, hotelId), isNull(schema.roomItems.retiredOn)))
    .orderBy(asc(schema.rooms.floor), asc(schema.rooms.number), asc(schema.roomItems.name));
  const problems = live.filter((r) => r.item.condition === "damaged" || r.item.condition === "missing");
  const soon = addDaysISO(today, 14);
  const service = live
    .map((r) => ({ ...r, due: nextServiceDate(r.item) }))
    .filter((r): r is typeof r & { due: string } => !!r.due && r.due <= soon)
    .sort((a, b) => (a.due < b.due ? -1 : 1));
  return { live, problems, service, noStartCheck: await roomsWithoutStartCheck(hotelId) };
}
