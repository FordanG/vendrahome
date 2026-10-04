"use server";

import { mutate } from "@/lib/mutations";

import { revalidatePath } from "next/cache";
import { and, eq, isNotNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN, requireStaff } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { checkRoomAvailable } from "@/lib/assignments";
import { normalizeDate, parseCsv } from "@/lib/csv";
import { OCCUPANT_FIELDS, readOccupantDetails, STAY_COLUMNS } from "@/lib/occupants";
import type { ActionState } from "@/lib/action-state";

export async function importOccupants(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
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
    if (!clientId || !await db.query.clients.findFirst({ where: eq(schema.clients.id, clientId) }))
      return { error: "Pick an existing company for this import." };
    const [rooms, existing] = await Promise.all([
      db.select().from(schema.rooms),
      db.select({ employeeId: schema.occupants.employeeId }).from(schema.occupants)
        .where(and(isNotNull(schema.occupants.employeeId), eq(schema.occupants.clientId, clientId))),
    ]);
    const roomByNumber = new Map(rooms.map(r => [r.number.toLowerCase(), r]));
    const knownIds = new Set(existing.map((e) => e.employeeId!.toLowerCase()));

    const errors: string[] = [];
    const inserted: string[] = [];
    let assigned = 0;
    const importRow = async (cells: string[], i: number) => {

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
      if (!roomNumber) {
        const [o] = await db.insert(schema.occupants).values({ ...details.value, clientId }).returning();
        inserted.push(o.id);
        return;
      }
      const room = roomByNumber.get(roomNumber.toLowerCase());
      if (!room) return void errors.push(`Row ${line}: room "${roomNumber}" doesn't exist.`);
      if (room.condition === "not_available") return void errors.push(`Row ${line}: room ${room.number} is out of service.`);
      const checkIn = normalizeDate(cell("check_in"));
      if (!checkIn) return void errors.push(`Row ${line}: check_in date is missing or not a date.`);
      const expectedRaw = cell("expected_check_out");
      const expectedCheckOut = expectedRaw ? normalizeDate(expectedRaw) : null;
      if (expectedRaw && !expectedCheckOut) return void errors.push(`Row ${line}: expected_check_out isn't a date.`);
      if (expectedCheckOut && expectedCheckOut < checkIn) return void errors.push(`Row ${line}: expected_check_out is before check_in.`);
      const slot = cell("bed") || cell("slot") || null;
      const check = await checkRoomAvailable({ roomId: room.id, slot, checkIn, expectedCheckOut, clientId });
      if ("error" in check) return void errors.push(`Row ${line}: ${check.error}`);
      const [o] = await db.insert(schema.occupants).values({ ...details.value, clientId }).returning();
      await db.insert(schema.roomAssignments).values({
        roomId: room.id, slot, checkIn, expectedCheckOut, occupantId: o.id,
        keysIssued: cell("keys_issued") || null, contractId: check.contractId, assignedBy: user.id,
      });
      inserted.push(o.id);
      assigned++;
    };
    for (const [i, cells] of rows.slice(1).entries()) await importRow(cells, i);

    if (errors.length > 0) {
      return {
        error: `Nothing was imported. Fix these rows and try again:\n${errors.slice(0, 25).join("\n")}${
          errors.length > 25 ? `\n…and ${errors.length - 25} more` : ""
        }`,
      };
    }

    await audit(user.id, "import", "occupant", null, { people: inserted.length, assigned, clientId, occupantIds: inserted });
    revalidatePath("/");
    revalidatePath("/occupants");
    revalidatePath("/assignments");
    return {
      ok: `Imported ${inserted.length} ${inserted.length === 1 ? "person" : "people"}; ${assigned} given a room.${
        unknown.length ? ` Ignored columns: ${unknown.join(", ")}.` : ""
      }`,
    };
  });
}

