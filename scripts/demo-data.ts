// Loads demo data for trying the app, or removes it again.
// Usage: pnpm db:demo          add demo data (run pnpm db:seed first)
//        pnpm db:demo:remove   delete everything the demo added
// Stop `pnpm dev` first: only one process can open the database at a time.
//
// The demo matches the first real setup: one company leases every room, every
// room is occupied by 2–3 people, and rooms come in a few types.
//
// The IDs of every row it adds, and the room settings it changes, are saved
// next to the database (<PGLITE_DIR>-demo.json), so removal only undoes the demo.
import path from "node:path";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { asc, eq, inArray, isNull, or } from "drizzle-orm";
import bcrypt from "bcryptjs";
import * as schema from "../src/db/schema";
import { addDaysISO, todayISO } from "../src/lib/format";

const PASSWORD = "demo1234";

const FIRST = ["Juan", "Maria", "Paolo", "Angelica", "Mark", "Kristine", "John Paul", "Camille", "Rafael", "Jasmine",
  "Carlo", "Patricia", "Miguel", "Andrea", "Joshua", "Nicole", "Christian", "Bea", "Jerome", "Katrina"];
const LAST = ["Dela Cruz", "Santos", "Reyes", "Garcia", "Mendoza", "Bautista", "Villanueva", "Ramos", "Aquino", "Castillo",
  "Navarro", "Torres", "Flores", "Gonzales", "Lopez", "Rivera", "Cruz", "Morales", "Domingo", "Pascual"];
const POSITIONS = ["Customer Service Rep", "Team Leader", "Quality Analyst", "IT Support", "Trainer", "Workforce Analyst"];
const DEPARTMENTS = ["Operations", "Quality", "IT", "Training", "HR"];
const SHIFTS = ["Night shift, 10 PM – 7 AM", "Mid shift, 2 PM – 11 PM", "Day shift, 8 AM – 5 PM"];
const BEDS = ["Bed A", "Bed B", "Bed C", "Bed D"];

// Twin and Triple on the lower floors, Lofts on the top floor.
const ROOM_TYPES = [
  { name: "Twin", defaultCapacity: 2, notes: "Two single beds." },
  { name: "Triple", defaultCapacity: 3, notes: "Three single beds." },
  { name: "Loft", defaultCapacity: 3, notes: "Double-height room with a sleeping loft: one bed below, two upstairs." },
];

// Tenant logins: person 0, 1 and 2 take Bed A in these rooms (one of each type, different floors).
const TENANTS = [
  { index: 0, room: "203", username: "demo.juan" },
  { index: 1, room: "312", username: "demo.maria" },
  { index: 2, room: "507", username: "demo.paolo" },
];

type DemoIds = {
  clients: string[];
  contracts: string[];
  occupants: string[];
  assignments: string[];
  staff: string[];
  houseRules: string[];
  schedule: string[];
  visits: string[];
  requests: string[];
  roomTypes?: string[];
  roomsBefore?: { id: string; roomTypeId: string | null; capacity: number; condition: "ready" | "needs_work" | "not_available"; notes: string | null }[];
};

async function open() {
  const dataDir = process.env.PGLITE_DIR ?? path.join(process.cwd(), ".data", "pglite");
  const client = await PGlite.create(dataDir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  return { client, db, idsFile: `${dataDir}-demo.json` };
}

async function add() {
  const { client, db, idsFile } = await open();
  if (existsSync(idsFile)) {
    console.log("Demo data is already loaded. Remove it first with: pnpm db:demo:remove");
    await client.close();
    return;
  }
  let rooms = await db.select().from(schema.rooms).orderBy(asc(schema.rooms.floor), asc(schema.rooms.number));
  if (rooms.length === 0) {
    console.log("No rooms yet. Run pnpm db:seed first.");
    await client.close();
    return;
  }
  const occupiedNow = await db
    .select({ roomId: schema.roomAssignments.roomId })
    .from(schema.roomAssignments)
    .where(isNull(schema.roomAssignments.actualCheckOut));
  if (occupiedNow.length > 0) {
    console.log("Some rooms already have people in them. The demo fills every room, so it only runs on a hotel with no one checked in.");
    await client.close();
    return;
  }

  const admin = await db.query.staff.findFirst({ where: eq(schema.staff.role, "admin") });
  const ids: DemoIds = {
    clients: [], contracts: [], occupants: [], assignments: [], staff: [], houseRules: [], schedule: [], visits: [], requests: [],
    roomTypes: [],
    roomsBefore: rooms.map((r) => ({ id: r.id, roomTypeId: r.roomTypeId, capacity: r.capacity, condition: r.condition, notes: r.notes })),
  };
  const today = todayISO();
  const hash = await bcrypt.hash(PASSWORD, 10);

  // Room types (reuse any that already exist with the same name)
  const typeIds = new Map<string, string>();
  for (const t of ROOM_TYPES) {
    const existing = await db.query.roomTypes.findFirst({ where: eq(schema.roomTypes.name, t.name) });
    if (existing) typeIds.set(t.name, existing.id);
    else {
      const [created] = await db.insert(schema.roomTypes).values(t).returning();
      typeIds.set(t.name, created.id);
      ids.roomTypes!.push(created.id);
    }
  }
  const topFloor = Math.max(...rooms.map((r) => r.floor));
  for (const r of rooms) {
    const position = rooms.filter((x) => x.floor === r.floor).indexOf(r);
    const type = r.floor === topFloor ? "Loft" : position < 10 ? "Twin" : "Triple";
    const capacity = ROOM_TYPES.find((t) => t.name === type)!.defaultCapacity;
    await db.update(schema.rooms).set({ roomTypeId: typeIds.get(type)!, capacity, condition: "ready" }).where(eq(schema.rooms.id, r.id));
  }
  // One occupied room that staff marked as needing work
  const repaint = rooms.find((r) => r.number === "414") ?? rooms[rooms.length - 2];
  await db.update(schema.rooms).set({ condition: "needs_work", notes: "Bathroom repainting this week." }).where(eq(schema.rooms.id, repaint.id));
  rooms = await db.select().from(schema.rooms).orderBy(asc(schema.rooms.floor), asc(schema.rooms.number));
  const roomByNumber = new Map(rooms.map((r) => [r.number, r]));

  // Staff
  const staffRows = await db
    .insert(schema.staff)
    .values([
      { name: "Maricel Santos (demo)", username: "demo.desk", role: "front_desk", passwordHash: hash },
      { name: "Rodel Bautista (demo)", username: "demo.fix", role: "maintenance", passwordHash: hash },
    ])
    .returning();
  ids.staff.push(...staffRows.map((s) => s.id));
  const [desk, fix] = staffRows;

  // Client and a 2-year contract over every room not already under an active contract
  const [company] = await db
    .insert(schema.clients)
    .values({
      name: "Pacific Outsourcing Inc. (demo)",
      tin: "000-123-456-000",
      address: "12th Floor, Cyber One Building, Eastwood City, Quezon City",
      contactName: "Liza Mercado",
      contactPhone: "0917 555 0101",
      contactEmail: "liza.mercado@example.com",
      notes: "Demo client for testing.",
    })
    .returning();
  ids.clients.push(company.id);

  const taken = new Set(
    (
      await db
        .select({ roomId: schema.contractRooms.roomId })
        .from(schema.contractRooms)
        .innerJoin(schema.contracts, eq(schema.contractRooms.contractId, schema.contracts.id))
        .where(eq(schema.contracts.status, "active"))
    ).map((r) => r.roomId),
  );
  const free = rooms.filter((r) => !taken.has(r.id));
  const startDate = addDaysISO(today, -57);
  const [contract] = await db
    .insert(schema.contracts)
    .values({
      clientId: company.id,
      reference: "DEMO-2026-001",
      startDate,
      endDate: addDaysISO(addDaysISO(startDate, 365 * 2), -1),
      rentType: "total",
      monthlyRent: free.length * 18_000_00,
      deposit: free.length * 18_000_00 * 2,
      advance: free.length * 18_000_00,
      billingDay: 5,
      paymentTerms: "Bank transfer within 7 days of the statement",
      notes: "Demo contract for testing.",
      status: "active",
    })
    .returning();
  ids.contracts.push(contract.id);
  if (free.length) {
    await db.insert(schema.contractRooms).values(free.map((r) => ({ contractId: contract.id, roomId: r.id })));
  }
  await db.insert(schema.rentSteps).values({ contractId: contract.id, startMonth: 13, kind: "percent", value: 500, note: "Year 2: +5%" });

  // Beds to fill: every bed in every room, except one free bed in a few rooms.
  // The tenant logins take Bed A in their rooms first.
  const tenantRooms = TENANTS.map((t) => roomByNumber.get(t.room)).filter((r): r is (typeof rooms)[number] => !!r);
  const beds: { room: (typeof rooms)[number]; slot: string }[] = tenantRooms.map((room) => ({ room, slot: BEDS[0] }));
  rooms.forEach((room, i) => {
    const filled = i % 13 === 6 ? room.capacity - 1 : room.capacity;
    for (let b = 0; b < filled; b++) {
      if (b === 0 && tenantRooms.includes(room)) continue;
      beds.push({ room, slot: BEDS[b] });
    }
  });

  const person = (i: number) => {
    const first = FIRST[i % FIRST.length];
    // Unique first + last pairs for up to 400 people
    const last = LAST[(Math.floor(i / FIRST.length) + 3 * (i % FIRST.length)) % LAST.length];
    return {
      clientId: company.id,
      fullName: `${first} ${last}`,
      nickname: first.split(" ")[0],
      sex: i % 2 === 0 ? "Male" : "Female",
      birthDate: `${1988 + (i % 12)}-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 27) + 1).padStart(2, "0")}`,
      nationality: "Filipino",
      civilStatus: i % 4 === 0 ? "Married" : "Single",
      mobile: `0917 ${String(100 + ((i * 37) % 900))} ${String(1000 + ((i * 53) % 9000))}`,
      email: `${first.split(" ")[0].toLowerCase()}.${last.replace(/\s/g, "").toLowerCase()}${i}@example.com`,
      homeAddress: ["Cebu City", "Davao City", "Iloilo City", "Bacolod City", "Baguio City"][i % 5],
      employeeId: `PO-${2400 + i}`,
      position: POSITIONS[i % POSITIONS.length],
      department: DEPARTMENTS[i % DEPARTMENTS.length],
      shift: SHIFTS[i % SHIFTS.length],
      idType: "PhilSys",
      idNumber: `1234-5678-${1000 + i}`,
      emergencyName: `${FIRST[(i + 5) % FIRST.length]} ${last}`,
      emergencyRelationship: ["Mother", "Father", "Spouse", "Sibling"][i % 4],
      emergencyMobile: `0918 ${String(100 + ((i * 41) % 900))} ${String(1000 + ((i * 29) % 9000))}`,
      notes: "Demo occupant.",
    };
  };

  const pastCount = 3;
  const occupants = await db
    .insert(schema.occupants)
    .values([
      ...beds.map((_, i) => ({ ...person(i), status: "active" as const })),
      ...Array.from({ length: pastCount }, (_, k) => ({ ...person(beds.length + k), status: "inactive" as const })),
    ])
    .returning();
  ids.occupants.push(...occupants.map((o) => o.id));

  const stays: (typeof schema.roomAssignments.$inferInsert)[] = beds.map((bed, i) => ({
    occupantId: occupants[i].id,
    roomId: bed.room.id,
    contractId: contract.id,
    slot: bed.slot,
    checkIn: addDaysISO(startDate, (i % 10) * 2),
    expectedCheckOut: i % 61 === 7 ? addDaysISO(today, 3 + (i % 4)) : null,
    keysIssued: "1 key card, 1 locker key",
    assignedBy: desk.id,
  }));
  // People who stayed for a while and left, in rooms that now have a free bed
  const roomsWithSpace = rooms.filter((_, i) => i % 13 === 6);
  for (let k = 0; k < pastCount; k++) {
    stays.push({
      occupantId: occupants[beds.length + k].id,
      roomId: roomsWithSpace[k % roomsWithSpace.length].id,
      contractId: contract.id,
      slot: BEDS[roomsWithSpace[k % roomsWithSpace.length].capacity - 1],
      checkIn: startDate,
      actualCheckOut: addDaysISO(startDate, 20 + k * 5),
      keysIssued: "1 key card",
      assignedBy: desk.id,
      notes: "Check-out: Keys returned, bed left clean",
    });
  }
  const assignments = await db.insert(schema.roomAssignments).values(stays).returning();
  ids.assignments.push(...assignments.map((a) => a.id));
  const roomOf = (i: number) => beds[i].room.id;

  // Tenant logins
  const tenantLogins = await db
    .insert(schema.staff)
    .values(
      TENANTS.map((t) => ({
        name: occupants[t.index].fullName,
        username: t.username,
        role: "tenant" as const,
        occupantId: occupants[t.index].id,
        passwordHash: hash,
      })),
    )
    .returning();
  ids.staff.push(...tenantLogins.map((s) => s.id));

  // House rules
  const rules = await db
    .insert(schema.houseRules)
    .values([
      { position: 1, title: "Quiet hours", body: "Keep noise down from 10 PM to 6 AM. Many residents work night shifts and sleep during the day, so please be considerate of your roommates at all hours." },
      { position: 2, title: "Shared rooms", body: "Keep your things in your own bed area and locker. Agree with your roommates on lights-out and aircon settings, and tell the front desk if you can't settle something." },
      { position: 3, title: "Visitors", body: "Visitors register at the front desk and leave a valid ID. Visiting hours are 8 AM to 9 PM, in the lobby only. No overnight guests." },
      { position: 4, title: "Kitchen", body: "Use the kitchen only during your floor's time slots. Wash, dry and put away everything you use, and wipe the counters and stove." },
      { position: 5, title: "Laundry", body: "Leave your laundry bag at the lobby by 8 AM on pickup days. Label every bag with your room number and bed. Laundry is charged per kilo." },
      { position: 6, title: "No smoking or vaping", body: "Smoking and vaping are not allowed inside the building. Use the smoking area at the back gate." },
      { position: 7, title: "Garbage", body: "Separate biodegradable, recyclable and residual waste. Bring garbage to the bins at the ground floor before 9 PM." },
      { position: 8, title: "Report problems early", body: "Report leaks, broken fixtures or aircon problems through the app as soon as you notice them." },
    ])
    .returning();
  ids.houseRules.push(...rules.map((r) => r.id));

  // Kitchen: each floor has its own breakfast and dinner slot every day. Laundry: pickup Tuesday and Friday.
  const floors = [...new Set(rooms.map((r) => r.floor))];
  const pad = (h: number) => `${String(h).padStart(2, "0")}:00`;
  const scheduleValues: (typeof schema.weeklySchedule.$inferInsert)[] = [];
  floors.forEach((floor, i) => {
    for (let weekday = 1; weekday <= 7; weekday++) {
      scheduleValues.push({ kind: "kitchen", weekday, floor, startTime: pad(5 + i), endTime: pad(6 + i), note: "Breakfast" });
      scheduleValues.push({ kind: "kitchen", weekday, floor, startTime: pad(17 + (i % 4)), endTime: pad(18 + (i % 4)), note: "Dinner" });
    }
  });
  for (const weekday of [2, 5]) {
    scheduleValues.push({ kind: "laundry", weekday, startTime: "08:00", endTime: "10:00", note: "Bags at the lobby by 8 AM, back the next day" });
  }
  const schedule = await db.insert(schema.weeklySchedule).values(scheduleValues).returning();
  ids.schedule.push(...schedule.map((s) => s.id));

  // Requests in every state. Open problem reports and maintenance requests mark their rooms as needing work.
  const at = (daysAgo: number, hour: number) => new Date(`${addDaysISO(today, -daysAgo)}T${pad(hour)}:00+08:00`);
  const occ = (i: number) => occupants[i];
  const loftBed = Math.max(beds.findIndex((b, i) => i > TENANTS.length && b.room.roomTypeId === typeIds.get("Loft")), 3);
  const requestValues: (typeof schema.tenantRequests.$inferInsert)[] = [
    { occupantId: occ(0).id, roomId: roomOf(0), kind: "maintenance", details: "The shower drain is slow. Water pools for a few minutes after every shower.", preferredDate: addDaysISO(today, 5), preferredTime: "After 6 PM", createdAt: at(0, 9) },
    { occupantId: occ(1).id, roomId: roomOf(1), kind: "laundry", details: "I'm on a business trip Tuesday to Thursday. Can my laundry be picked up on Monday instead?", preferredDate: addDaysISO(today, 1), preferredTime: "Morning", createdAt: at(1, 20) },
    { occupantId: occ(20).id, roomId: roomOf(20), kind: "issue", urgent: true, details: "Water is leaking under the bathroom sink. We put a towel down but it keeps dripping.", createdAt: at(0, 7) },
    { occupantId: occ(loftBed).id, roomId: roomOf(loftBed), kind: "issue", details: "The ladder up to the loft is wobbly.", createdAt: at(1, 22) },
    {
      occupantId: occ(2).id, roomId: roomOf(2), kind: "issue", details: "The door knob is loose and hard to lock.", status: "approved",
      scheduledDate: addDaysISO(today, -1), scheduledFrom: "14:00", scheduledTo: "15:00", response: "Our maintenance staff will fix it.",
      handledBy: desk.id, handledAt: at(2, 10), createdAt: at(3, 21),
    },
    {
      occupantId: occ(41).id, roomId: roomOf(41), kind: "maintenance", details: "The aircon is noisy at night and not very cold.", preferredDate: addDaysISO(today, 2), preferredTime: "Before noon", status: "approved",
      scheduledDate: addDaysISO(today, 2), scheduledFrom: "10:00", scheduledTo: "11:00", response: "Technician will check it in the morning.",
      handledBy: fix.id, handledAt: at(1, 11), createdAt: at(2, 8),
    },
    {
      occupantId: occ(0).id, roomId: roomOf(0), kind: "laundry", details: "Can I have my laundry picked up on Sunday?", preferredDate: addDaysISO(today, -4), status: "declined",
      response: "Sorry, the laundry shop is closed on Sundays. Please use the Tuesday pickup.", handledBy: desk.id, handledAt: at(6, 9), createdAt: at(7, 22),
    },
    {
      occupantId: occ(90).id, roomId: roomOf(90), kind: "issue", details: "The light in the bathroom is flickering.", status: "done",
      response: "Replaced the bulb.", handledBy: fix.id, handledAt: at(10, 15), createdAt: at(11, 19),
    },
  ];
  const requests = await db.insert(schema.tenantRequests).values(requestValues).returning();
  ids.requests.push(...requests.map((r) => r.id));

  // Maintenance visits: upcoming, overdue and past, plus the one booked from the approved request
  const floorRooms = (f: number) => rooms.filter((r) => r.floor === f);
  const approvedMaintenance = requests.find((r) => r.kind === "maintenance" && r.status === "approved")!;
  const visitValues: (typeof schema.maintenanceVisits.$inferInsert)[] = [
    ...floorRooms(floors[1] ?? floors[0]).map((r) => ({ roomId: r.id, title: "Aircon cleaning", date: addDaysISO(today, 3), timeFrom: "09:00", timeTo: "12:00", createdBy: fix.id })),
    ...floorRooms(floors[2] ?? floors[0]).map((r) => ({ roomId: r.id, title: "Aircon cleaning", date: addDaysISO(today, 4), timeFrom: "09:00", timeTo: "12:00", createdBy: fix.id })),
    ...rooms.map((r) => ({ roomId: r.id, title: "Pest control", date: addDaysISO(today, 12), timeFrom: "13:00", timeTo: "17:00", notes: "Please keep food sealed.", createdBy: fix.id })),
    ...floorRooms(floors[0]).map((r, i) => ({
      roomId: r.id,
      title: "Monthly room check",
      date: addDaysISO(today, -9),
      timeFrom: "10:00",
      timeTo: "15:00",
      status: (i === 4 ? "missed" : "done") as "missed" | "done",
      notes: i === 4 ? "No one home, reschedule." : null,
      createdBy: fix.id,
    })),
    { roomId: roomOf(2), title: "Fix loose door knob", date: addDaysISO(today, -1), timeFrom: "14:00", timeTo: "15:00", createdBy: fix.id },
    {
      roomId: approvedMaintenance.roomId!,
      requestId: approvedMaintenance.id,
      title: "Requested by tenant",
      notes: approvedMaintenance.details,
      date: approvedMaintenance.scheduledDate!,
      timeFrom: approvedMaintenance.scheduledFrom,
      timeTo: approvedMaintenance.scheduledTo,
      createdBy: fix.id,
    },
  ];
  const visits = await db.insert(schema.maintenanceVisits).values(visitValues).returning();
  ids.visits.push(...visits.map((v) => v.id));

  writeFileSync(idsFile, JSON.stringify(ids, null, 2));
  await client.close();

  const count = (type: string) => rooms.filter((r) => r.roomTypeId === typeIds.get(type)).length;
  console.log(`Demo data added:
  ${rooms.length} rooms: ${ROOM_TYPES.map((t) => `${count(t.name)} ${t.name} (${t.defaultCapacity} beds)`).join(", ")}
  1 client, 1 contract over ${free.length} rooms
  ${beds.length} people in ${rooms.reduce((n, r) => n + r.capacity, 0)} beds, 3 already checked out
  ${rules.length} house rules, ${schedule.length} kitchen and laundry time slots
  ${visits.length} maintenance visits, ${requests.length} tenant requests, room ${repaint.number} marked needs work

Sign in with any of these (password for all: ${PASSWORD}):
  demo.desk    front desk & housekeeping
  demo.fix     maintenance
${TENANTS.map((t) => `  ${t.username.padEnd(12)} tenant, room ${t.room} (${occupants[t.index].fullName})`).join("\n")}
${admin ? `  ${admin.username.padEnd(12)} your own admin password` : ""}

Remove it all later with: pnpm db:demo:remove`);
}

async function remove() {
  const { client, db, idsFile } = await open();
  if (!existsSync(idsFile)) {
    console.log("No demo data found (nothing to remove).");
    await client.close();
    return;
  }
  const ids: DemoIds = JSON.parse(readFileSync(idsFile, "utf8"));
  const some = (list: string[] | undefined) => (list?.length ? list : ["00000000-0000-0000-0000-000000000000"]);

  await db.transaction(async (tx) => {
    // Requests and visits the demo people made while testing go too.
    const requests = await tx
      .select({ id: schema.tenantRequests.id })
      .from(schema.tenantRequests)
      .where(or(inArray(schema.tenantRequests.id, some(ids.requests)), inArray(schema.tenantRequests.occupantId, some(ids.occupants))));
    const requestIds = requests.map((r) => r.id);
    await tx
      .delete(schema.maintenanceVisits)
      .where(
        or(
          inArray(schema.maintenanceVisits.id, some(ids.visits)),
          inArray(schema.maintenanceVisits.requestId, some(requestIds)),
          inArray(schema.maintenanceVisits.createdBy, some(ids.staff)),
        ),
      );
    await tx.delete(schema.tenantRequests).where(inArray(schema.tenantRequests.id, some(requestIds)));
    await tx.delete(schema.weeklySchedule).where(inArray(schema.weeklySchedule.id, some(ids.schedule)));
    await tx.delete(schema.houseRules).where(inArray(schema.houseRules.id, some(ids.houseRules)));
    await tx.delete(schema.staff).where(inArray(schema.staff.id, some(ids.staff)));
    await tx
      .delete(schema.roomAssignments)
      .where(or(inArray(schema.roomAssignments.id, some(ids.assignments)), inArray(schema.roomAssignments.occupantId, some(ids.occupants))));
    await tx.delete(schema.occupants).where(inArray(schema.occupants.id, some(ids.occupants)));
    // Stays someone else added under the demo contract stay, without the contract.
    await tx
      .update(schema.roomAssignments)
      .set({ contractId: null })
      .where(inArray(schema.roomAssignments.contractId, some(ids.contracts)));
    await tx.delete(schema.contracts).where(inArray(schema.contracts.id, some(ids.contracts)));
    await tx.delete(schema.clients).where(inArray(schema.clients.id, some(ids.clients)));
    // Put rooms back the way they were, then drop the room types the demo created.
    for (const r of ids.roomsBefore ?? []) {
      await tx
        .update(schema.rooms)
        .set({ roomTypeId: r.roomTypeId, capacity: r.capacity, condition: r.condition, notes: r.notes })
        .where(eq(schema.rooms.id, r.id));
    }
    await tx.delete(schema.roomTypes).where(inArray(schema.roomTypes.id, some(ids.roomTypes)));
  });
  rmSync(idsFile);
  await client.close();
  console.log("Demo data removed. Your own accounts, rooms and anything you added yourself are still there.");
}

(process.argv.includes("--remove") ? remove() : add()).catch((err) => {
  console.error(err);
  process.exit(1);
});
