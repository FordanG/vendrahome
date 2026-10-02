"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN, requireStaff } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { normalizeDate, parseCsv } from "@/lib/csv";
import { OCCUPANT_FIELDS, readOccupantDetails, STAY_COLUMNS, type OccupantFieldKey } from "@/lib/occupants";
import type { ActionState } from "@/lib/action-state";

export async function importOccupants(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireStaff(CAN.manageOccupants);
  const clientId = String(fd.get("clientId") ?? "") || null;
  const file = fd.get("file");
  let text = String(fd.get("pasted") ?? "");
  if (file instanceof File && file.size > 0) {
    if (file.size > 2_000_000) return { error: "The file is too large (over 2 MB)." };
    text = await file.text();
  }
  const rows = parseCsv(text);
  if (rows.length < 2) return { error: "Add a CSV file or paste rows, with the header row first." };

  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const col = (name: string) => header.indexOf(name);
  if (col("full_name") < 0) return { error: 'The header row needs a "full_name" column. Download the template to see all columns.' };
  const known = new Set<string>([...OCCUPANT_FIELDS.map((f) => f.csv), ...STAY_COLUMNS]);
  const unknown = header.filter((h) => h && !known.has(h));

  const db = await getDb();
  const [rooms, open, existing, contracts] = await Promise.all([
    db.select().from(schema.rooms),
    db.select({ roomId: schema.roomAssignments.roomId, slot: schema.roomAssignments.slot }).from(schema.roomAssignments).where(isNull(schema.roomAssignments.actualCheckOut)),
    db
      .select({ employeeId: schema.occupants.employeeId })
      .from(schema.occupants)
      .where(and(isNotNull(schema.occupants.employeeId), clientId ? eq(schema.occupants.clientId, clientId) : undefined)),
    db
      .select({ roomId: schema.contractRooms.roomId, id: schema.contracts.id, startDate: schema.contracts.startDate, endDate: schema.contracts.endDate })
      .from(schema.contractRooms)
      .innerJoin(schema.contracts, eq(schema.contractRooms.contractId, schema.contracts.id))
      .where(eq(schema.contracts.status, "active")),
  ]);
  const roomByNumber = new Map(rooms.map((r) => [r.number.toLowerCase(), r]));
  const taken = new Map<string, number>();
  const slots = new Set<string>();
  for (const o of open) {
    taken.set(o.roomId, (taken.get(o.roomId) ?? 0) + 1);
    if (o.slot) slots.add(`${o.roomId}|${o.slot.toLowerCase()}`);
  }
  const knownIds = new Set(existing.map((e) => e.employeeId!.toLowerCase()));

  const errors: string[] = [];
  const toInsert: {
    details: Record<OccupantFieldKey, string | null> & { fullName: string };
    stay: { roomId: string; slot: string | null; checkIn: string; expectedCheckOut: string | null; keysIssued: string | null; contractId: string | null } | null;
  }[] = [];

  rows.slice(1).forEach((cells, i) => {
    const line = i + 2;
    const cell = (name: string) => (col(name) >= 0 ? (cells[col(name)] ?? "").trim() : "");
    const byKey = new Map(OCCUPANT_FIELDS.map((f) => [f.key, cell(f.csv)]));
    const birth = byKey.get("birthDate");
    if (birth) byKey.set("birthDate", normalizeDate(birth) ?? birth);
    const details = readOccupantDetails((k) => byKey.get(k));
    if ("error" in details) return void errors.push(`Row ${line}: ${details.error}`);

    const empId = details.value.employeeId?.toLowerCase();
    if (empId) {
      if (knownIds.has(empId)) return void errors.push(`Row ${line}: employee ID ${details.value.employeeId} is already on file.`);
      knownIds.add(empId);
    }

    const roomNumber = cell("room");
    if (!roomNumber) return void toInsert.push({ details: details.value, stay: null });
    const room = roomByNumber.get(roomNumber.toLowerCase());
    if (!room) return void errors.push(`Row ${line}: room "${roomNumber}" doesn't exist.`);
    if (room.condition === "not_available") return void errors.push(`Row ${line}: room ${room.number} is out of service.`);
    const checkIn = normalizeDate(cell("check_in"));
    if (!checkIn) return void errors.push(`Row ${line}: check_in date is missing or not a date.`);
    const expectedRaw = cell("expected_check_out");
    const expectedCheckOut = expectedRaw ? normalizeDate(expectedRaw) : null;
    if (expectedRaw && !expectedCheckOut) return void errors.push(`Row ${line}: expected_check_out isn't a date.`);
    if (expectedCheckOut && expectedCheckOut < checkIn) return void errors.push(`Row ${line}: expected_check_out is before check_in.`);
    const count = taken.get(room.id) ?? 0;
    if (count >= room.capacity) return void errors.push(`Row ${line}: room ${room.number} is full (all ${room.capacity} beds are taken).`);
    // "slot" was the old name of the bed column; files made with it still import.
    const slot = cell("bed") || cell("slot") || null;
    if (slot) {
      const key = `${room.id}|${slot.toLowerCase()}`;
      if (slots.has(key)) return void errors.push(`Row ${line}: ${slot} in room ${room.number} is already taken.`);
      slots.add(key);
    }
    taken.set(room.id, count + 1);
    const contract = contracts.find((c) => c.roomId === room.id && c.startDate <= checkIn && c.endDate >= checkIn);
    toInsert.push({
      details: details.value,
      stay: { roomId: room.id, slot, checkIn, expectedCheckOut, keysIssued: cell("keys_issued") || null, contractId: contract?.id ?? null },
    });
  });

  if (errors.length > 0) {
    return {
      error: `Nothing was imported. Fix these rows and try again:\n${errors.slice(0, 25).join("\n")}${
        errors.length > 25 ? `\n…and ${errors.length - 25} more` : ""
      }`,
    };
  }

  await db.transaction(async (tx) => {
    for (const row of toInsert) {
      const [o] = await tx.insert(schema.occupants).values({ ...row.details, clientId }).returning({ id: schema.occupants.id });
      if (row.stay) await tx.insert(schema.roomAssignments).values({ ...row.stay, occupantId: o.id, assignedBy: user.id });
    }
  });
  const assigned = toInsert.filter((r) => r.stay).length;
  await audit(user.id, "import", "occupant", null, { people: toInsert.length, assigned, clientId });
  revalidatePath("/");
  revalidatePath("/occupants");
  revalidatePath("/assignments");
  return {
    ok: `Imported ${toInsert.length} ${toInsert.length === 1 ? "person" : "people"}; ${assigned} given a room.${
      unknown.length ? ` Ignored columns: ${unknown.join(", ")}.` : ""
    }`,
  };
}

