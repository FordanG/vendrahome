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
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { and, asc, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import bcrypt from "bcryptjs";
import * as schema from "../src/db/schema";
import { connect, pgliteDir, usesHostedDb, type DB } from "../src/db/connect";
import { PROPERTY_RULES } from "../src/lib/property-rules";
import { addDaysISO, addMonthsISO, formatDate, todayISO } from "../src/lib/format";

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
  laundryServices?: string[];
  // Added with billing and inventory (older demo files don't have these yet).
  money?: { statements: string[]; charges: string[]; payments: string[]; deposits: string[]; utilityBills: string[] };
  items?: { templates: string[]; roomItems: string[]; checks: string[] };
  roomsBefore?: { id: string; roomTypeId: string | null; capacity: number; condition: "ready" | "needs_work" | "not_available"; notes: string | null }[];
};

async function open() {
  const { db, close } = await connect({ migrate: true });
  // Remembers what the demo added, so it can be taken out again. Kept on this machine.
  const idsFile = usesHostedDb() ? path.join(process.cwd(), ".data", "hosted-demo.json") : `${pgliteDir()}-demo.json`;
  mkdirSync(path.dirname(idsFile), { recursive: true });
  return { client: { close }, db, idsFile };
}

async function add() {
  const { client, db, idsFile } = await open();
  if (existsSync(idsFile)) {
    const loaded: DemoIds = JSON.parse(readFileSync(idsFile, "utf8"));
    if (loaded.money && loaded.items) {
      console.log("Demo data is already loaded. Remove it first with: pnpm db:demo:remove");
    } else {
      await addMoneyAndItems(db, loaded);
      writeFileSync(idsFile, JSON.stringify(loaded, null, 2));
      console.log("Added demo billing (statements, payments, utilities, deposit) and room inventory to the demo data already loaded.");
    }
    await client.close();
    return;
  }
  // The demo fills the first hotel; other hotels are left alone.
  const [hotel] = await db.select().from(schema.properties).orderBy(asc(schema.properties.createdAt)).limit(1);
  let rooms = hotel
    ? await db.select().from(schema.rooms).where(eq(schema.rooms.propertyId, hotel.id)).orderBy(asc(schema.rooms.floor), asc(schema.rooms.number))
    : [];
  if (!hotel || rooms.length === 0) {
    console.log("No rooms yet. Run pnpm db:seed first.");
    await client.close();
    return;
  }
  const occupiedNow = await db
    .select({ roomId: schema.roomAssignments.roomId })
    .from(schema.roomAssignments)
    .where(and(isNull(schema.roomAssignments.actualCheckOut), inArray(schema.roomAssignments.roomId, rooms.map((x) => x.id))));
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
  rooms = await db.select().from(schema.rooms).where(eq(schema.rooms.propertyId, hotel.id)).orderBy(asc(schema.rooms.floor), asc(schema.rooms.number));
  const roomByNumber = new Map(rooms.map((r) => [r.number, r]));

  // Staff
  const staffRows = await db
    .insert(schema.staff)
    .values([
      { name: "Maricel Santos (demo)", username: "demo.desk", role: "front_desk", propertyId: hotel.id, passwordHash: hash },
      { name: "Rodel Bautista (demo)", username: "demo.fix", role: "maintenance", propertyId: hotel.id, passwordHash: hash },
      // An admin to try the admin pages with, so the real admin password never has to be shared.
      { name: "Carmela Reyes (demo)", username: "demo.admin", role: "admin", passwordHash: hash },
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

  // The company's own logins: its HR lead (company admin) and a coordinator (company staff).
  const companyLogins = await db
    .insert(schema.staff)
    .values([
      { name: "Liza Mercado (demo)", username: "demo.hr", role: "company_admin", clientId: company.id, passwordHash: hash },
      { name: "Jun Aquino (demo)", username: "demo.coord", role: "company_staff", clientId: company.id, passwordHash: hash },
    ])
    .returning();
  ids.staff.push(...companyLogins.map((s) => s.id));

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
      propertyId: hotel.id,
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
      ...beds.map((_, i) => ({ ...person(i), propertyId: hotel.id, status: "active" as const })),
      ...Array.from({ length: pastCount }, (_, k) => ({ ...person(beds.length + k), propertyId: hotel.id, status: "inactive" as const })),
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

  // Do not overwrite or duplicate the hotel's published policy with demo content.
  const hasRules = await db.query.houseRules.findFirst({ where: eq(schema.houseRules.propertyId, hotel.id) });
  const rules = hasRules ? [] : await db.insert(schema.houseRules).values(PROPERTY_RULES.map((rule) => ({ ...rule, propertyId: hotel.id }))).returning();
  ids.houseRules.push(...rules.map((r) => r.id));

  // Kitchen: each floor has its own breakfast and dinner slot every day. Laundry: pickup Tuesday and Friday.
  const floors = [...new Set(rooms.map((r) => r.floor))];
  const pad = (h: number) => `${String(h).padStart(2, "0")}:00`;
  const scheduleValues: (typeof schema.weeklySchedule.$inferInsert)[] = [];
  floors.forEach((floor, i) => {
    for (let weekday = 1; weekday <= 7; weekday++) {
      scheduleValues.push({ propertyId: hotel.id, kind: "kitchen", weekday, floor, startTime: pad(5 + i), endTime: pad(6 + i), note: "Breakfast" });
      scheduleValues.push({ propertyId: hotel.id, kind: "kitchen", weekday, floor, startTime: pad(17 + (i % 4)), endTime: pad(18 + (i % 4)), note: "Dinner" });
    }
  });
  for (const weekday of [2, 5]) {
    scheduleValues.push({ propertyId: hotel.id, kind: "laundry", weekday, startTime: "08:00", endTime: "10:00", note: "Bring bags to the front desk by 8 AM; back the next day" });
  }
  const schedule = await db.insert(schema.weeklySchedule).values(scheduleValues).returning();
  ids.schedule.push(...schedule.map((s) => s.id));

  // A laundry service with a price, so the desk can take bags in straight away.
  if (!(await db.query.laundryServices.findFirst({ where: eq(schema.laundryServices.propertyId, hotel.id) }))) {
    const [service] = await db
      .insert(schema.laundryServices)
      .values({ propertyId: hotel.id, name: "Wash, dry and fold", ratePerKilo: 60_00, costPerKilo: 40_00, minimumCharge: 180_00, turnaroundDays: 1 })
      .returning();
    ids.laundryServices = [service.id];
  }

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

  await addMoneyAndItems(db, ids);
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
  demo.admin   admin
  demo.desk    front desk & housekeeping
  demo.fix     maintenance
  demo.hr      company admin for ${company.name}
  demo.coord   company staff for ${company.name}
${TENANTS.map((t) => `  ${t.username.padEnd(12)} tenant, room ${t.room} (${occupants[t.index].fullName})`).join("\n")}
${admin ? `  ${admin.username.padEnd(12)} your own admin password` : ""}

Also: two issued statements (the second partly unpaid and overdue), utility bills, the deposit,
  tenant laundry charges, and a full room inventory with contract-start checks.

Remove it all later with: pnpm db:demo:remove`);
}


// Standard room contents. Prices are replacement costs in centavos.
const ITEM_LIST: { name: string; category: "furniture" | "appliance" | "fixture" | "issued"; perBed?: boolean; quantity?: number; cost: number; service?: number; loftOnly?: boolean }[] = [
  { name: "Bed frame", category: "furniture", perBed: true, cost: 8_000_00 },
  { name: "Mattress", category: "furniture", perBed: true, cost: 6_000_00 },
  { name: "Cabinet", category: "furniture", perBed: true, cost: 5_000_00 },
  { name: "Chair", category: "furniture", perBed: true, cost: 1_500_00 },
  { name: "Study table", category: "furniture", quantity: 1, cost: 4_500_00 },
  { name: "Loft ladder", category: "fixture", quantity: 1, cost: 3_500_00, loftOnly: true },
  { name: "Aircon", category: "appliance", quantity: 1, cost: 25_000_00, service: 6 },
  { name: "Curtains (set)", category: "fixture", quantity: 1, cost: 1_500_00 },
  { name: "Room key", category: "issued", perBed: true, cost: 300_00 },
  { name: "Key card", category: "issued", perBed: true, cost: 250_00 },
];

/**
 * Billing and room inventory for the demo contract: two months of statements,
 * utilities, the deposit, a few tenant charges, and every room's items and checks.
 * Works on a fresh demo and on one loaded before billing existed.
 */
async function addMoneyAndItems(db: DB, ids: DemoIds) {
  const today = todayISO();
  const money = (ids.money = { statements: [], charges: [], payments: [], deposits: [], utilityBills: [] } as NonNullable<DemoIds["money"]>);
  const items = (ids.items = { templates: [], roomItems: [], checks: [] } as NonNullable<DemoIds["items"]>);
  const contract = await db.query.contracts.findFirst({ where: inArray(schema.contracts.id, ids.contracts.length ? ids.contracts : ["00000000-0000-0000-0000-000000000000"]) });
  if (!contract) return;
  const desk = await db.query.staff.findFirst({ where: eq(schema.staff.username, "demo.desk") });
  const admin = (await db.query.staff.findFirst({ where: eq(schema.staff.username, "demo.admin") })) ?? desk;
  const by = admin?.id ?? null;
  const type = async (code: string) => (await db.query.chargeTypes.findFirst({ where: eq(schema.chargeTypes.code, code) }))!;
  const [rentType, utilityType, laundryType, lostKeyType] = await Promise.all([type("rent"), type("utility"), type("laundry"), type("lost_key")]);
  const charge = async (v: typeof schema.charges.$inferInsert) => {
    const [row] = await db.insert(schema.charges).values({ createdBy: by, ...v }).returning();
    money.charges.push(row.id);
    return row;
  };
  const pay = async (v: typeof schema.payments.$inferInsert) => {
    const [row] = await db.insert(schema.payments).values({ createdBy: by, ...v }).returning();
    money.payments.push(row.id);
    return row;
  };

  // Deposit received when the contract started.
  const [deposit] = await db.insert(schema.depositEntries).values({
    contractId: contract.id, kind: "received", amount: contract.deposit, entryOn: contract.startDate,
    description: "Security deposit, bank transfer ref. BDO-2026-0412", createdBy: by,
  }).returning();
  money.deposits.push(deposit.id);

  // Utilities: one electricity and one water bill for each full month so far.
  const electricity = await db.query.utilityTypes.findFirst({ where: eq(schema.utilityTypes.name, "Electricity") });
  const water = await db.query.utilityTypes.findFirst({ where: eq(schema.utilityTypes.name, "Water") });
  const utilityFor = async (periodStart: string, k: number) => {
    const periodEnd = addDaysISO(addMonthsISO(periodStart, 1), -1);
    if (periodEnd > today) return;
    for (const [u, amount] of [[electricity, [186_420_55, 201_337_10, 194_008_80][k % 3]], [water, [38_210_00, 41_005_50, 39_870_25][k % 3]]] as const) {
      if (!u) continue;
      const c = await charge({
        chargeTypeId: utilityType.id, billTo: "company", contractId: contract.id, amount, chargedOn: periodEnd,
        description: `${u.name}, ${formatDate(periodStart)} – ${formatDate(periodEnd)}`,
      });
      const [bill] = await db.insert(schema.utilityBills).values({
        utilityTypeId: u.id, contractId: contract.id, periodStart, periodEnd, dueDate: addDaysISO(periodEnd, 14), method: "bill", amount, chargeId: c.id, createdBy: by,
      }).returning();
      money.utilityBills.push(bill.id);
    }
  };

  // Statements for every month that has started more than a week ago.
  let previous = 0;
  for (let month = 1; ; month++) {
    const periodStart = addMonthsISO(contract.startDate, month - 1);
    if (periodStart > addDaysISO(today, -7)) break;
    const periodEnd = addDaysISO(addMonthsISO(contract.startDate, month), -1);
    const issuedOn = periodStart;
    const dueDate = addDaysISO(issuedOn, 7);
    if (month > 1) await utilityFor(addMonthsISO(contract.startDate, month - 2), month - 2);
    const unbilled = await db.select().from(schema.charges).where(and(eq(schema.charges.contractId, contract.id), eq(schema.charges.billTo, "company"), isNull(schema.charges.statementId)));
    const unapplied = await db.select().from(schema.payments).where(and(eq(schema.payments.contractId, contract.id), eq(schema.payments.billTo, "company"), isNull(schema.payments.statementId)));
    const newCharges = contract.monthlyRent + unbilled.reduce((n, c) => n + c.amount, 0);
    const paid = unapplied.reduce((n, p) => n + p.amount, 0);
    const [statement] = await db.insert(schema.statements).values({
      contractId: contract.id, number: `${contract.reference}-${String(month).padStart(2, "0")}`, rentMonth: month, periodStart, periodEnd, issuedOn, dueDate,
      previousBalance: previous, newCharges, paymentsReceived: paid, balanceDue: previous + newCharges - paid, createdBy: by,
    }).returning();
    money.statements.push(statement.id);
    await charge({
      chargeTypeId: rentType.id, billTo: "company", contractId: contract.id, amount: contract.monthlyRent, chargedOn: periodStart, rentMonth: month, statementId: statement.id,
      description: `Rent, month ${month} (${formatDate(periodStart)} – ${formatDate(periodEnd)})`,
    });
    for (const c of unbilled) await db.update(schema.charges).set({ statementId: statement.id }).where(eq(schema.charges.id, c.id));
    for (const p of unapplied) await db.update(schema.payments).set({ statementId: statement.id }).where(eq(schema.payments.id, p.id));
    previous = statement.balanceDue;
    // The company pays each statement a few days after it's issued; the latest one only covers the rent.
    const payOn = addDaysISO(issuedOn, 4);
    if (payOn <= today) {
      const isLatest = addMonthsISO(contract.startDate, month) > addDaysISO(today, -7);
      await pay({
        billTo: "company", contractId: contract.id, method: "bank_transfer", receivedOn: payOn,
        amount: isLatest ? contract.monthlyRent : statement.balanceDue, reference: `BDO-${String(70412 + month)}`, officialReceiptNo: `OR-${String(1000 + month)}`,
      });
    }
  }
  // This month's utilities are in but not billed yet, so the next statement has something to take in.
  const lastFull = addMonthsISO(contract.startDate, Math.max(money.statements.length - 1, 0));
  await utilityFor(lastFull, money.statements.length);

  // Tenant charges: laundry by the kilo and a lost key card.
  const tenants = await db
    .select({ occupantId: schema.staff.occupantId, username: schema.staff.username })
    .from(schema.staff)
    .where(inArray(schema.staff.username, TENANTS.map((t) => t.username)));
  const stayOf = async (occupantId: string) => db.query.roomAssignments.findFirst({ where: and(eq(schema.roomAssignments.occupantId, occupantId), isNull(schema.roomAssignments.actualCheckOut)) });
  for (const [i, t] of tenants.entries()) {
    if (!t.occupantId) continue;
    const stay = await stayOf(t.occupantId);
    const kilos = [4, 6, 3][i % 3];
    const first = await charge({ chargeTypeId: laundryType.id, billTo: "occupant", contractId: contract.id, occupantId: t.occupantId, roomId: stay?.roomId, amount: kilos * 60_00, chargedOn: addDaysISO(today, -12), description: `Laundry, ${kilos} kg at ₱60/kg` });
    await charge({ chargeTypeId: laundryType.id, billTo: "occupant", contractId: contract.id, occupantId: t.occupantId, roomId: stay?.roomId, amount: (kilos + 1) * 60_00, chargedOn: addDaysISO(today, -5), description: `Laundry, ${kilos + 1} kg at ₱60/kg` });
    await pay({ billTo: "occupant", occupantId: t.occupantId, method: "cash", receivedOn: addDaysISO(today, -10), amount: first.amount });
    if (t.username === "demo.paolo") {
      await charge({ chargeTypeId: lostKeyType.id, billTo: "occupant", contractId: contract.id, occupantId: t.occupantId, roomId: stay?.roomId, amount: 250_00, chargedOn: addDaysISO(today, -3), description: "Replacement key card" });
    }
  }

  // Room inventory: a standard list per room type, items in every room, and checks.
  const rooms = await db.select().from(schema.rooms).orderBy(asc(schema.rooms.floor), asc(schema.rooms.number));
  const roomTypes = await db.select().from(schema.roomTypes);
  for (const rt of roomTypes) {
    const list = ITEM_LIST.filter((it) => !it.loftOnly || rt.name === "Loft");
    const rows = await db.insert(schema.itemTemplates).values(list.map((it, position) => ({
      roomTypeId: rt.id, name: it.name, category: it.category, quantity: it.perBed ? rt.defaultCapacity : it.quantity ?? 1,
      replacementCost: it.cost, serviceEveryMonths: it.service ?? null, position,
    }))).returning();
    items.templates.push(...rows.map((r) => r.id));
  }
  const typeName = new Map(roomTypes.map((t) => [t.id, t.name]));
  const covered = new Set((await db.select({ roomId: schema.contractRooms.roomId }).from(schema.contractRooms).where(eq(schema.contractRooms.contractId, contract.id))).map((r) => r.roomId));
  const skipStartCheck = new Set(rooms.filter((r) => covered.has(r.id)).slice(-4).map((r) => r.id));
  const secondFloor = Math.min(...rooms.map((r) => r.floor)) + 1;
  for (const room of rooms) {
    const isLoft = typeName.get(room.roomTypeId ?? "") === "Loft";
    const list = ITEM_LIST.filter((it) => !it.loftOnly || isLoft);
    const created = await db.insert(schema.roomItems).values(list.map((it) => ({
      roomId: room.id, propertyId: room.propertyId, name: it.name, category: it.category, quantity: it.perBed ? room.capacity : it.quantity ?? 1, replacementCost: it.cost,
      serviceEveryMonths: it.service ?? null,
      // Second-floor aircons were last cleaned long ago, so they show as due for service.
      lastServicedOn: it.service ? (room.floor === secondFloor ? addDaysISO(today, -175) : addDaysISO(contract.startDate, -10)) : null,
      brand: it.name === "Aircon" ? "Carrier" : null, model: it.name === "Aircon" ? "Aura Inverter 1.0 HP" : null,
      tagCode: it.name === "Aircon" ? `AC-${room.number}` : null, createdAt: new Date(`${contract.startDate}T09:00:00+08:00`),
    }))).returning();
    items.roomItems.push(...created.map((c) => c.id));
    await db.insert(schema.itemEvents).values(created.map((c) => ({ itemId: c.id, kind: "added" as const, toRoomId: room.id, condition: "good" as const, note: "From the standard list", staffId: by, at: new Date(`${contract.startDate}T09:00:00+08:00`) })));
    if (!covered.has(room.id) || skipStartCheck.has(room.id)) continue;
    const [check] = await db.insert(schema.inventoryChecks).values({
      roomId: room.id, kind: "contract_start", contractId: contract.id, checkedOn: contract.startDate, checkedBy: desk?.id ?? by,
      signedBy: "Liza Mercado (Pacific Outsourcing)", notes: "Walk-through at contract start.",
    }).returning();
    items.checks.push(check.id);
    await db.insert(schema.inventoryCheckLines).values(created.map((c) => ({ checkId: check.id, itemId: c.id, found: c.quantity, condition: "good" as const })));
  }

  // A few things that need attention, and one move-out check with a missing key card.
  const itemIn = async (number: string, name: string) => {
    const room = rooms.find((r) => r.number === number);
    return room ? db.query.roomItems.findFirst({ where: and(eq(schema.roomItems.roomId, room.id), eq(schema.roomItems.name, name)) }) : undefined;
  };
  for (const [number, name, condition, note] of [["110", "Aircon", "damaged", "Leaking water onto the floor."], ["305", "Chair", "fair", "Seat cushion worn."], ["512", "Curtains (set)", "missing", "Not in the room at the spot check."]] as const) {
    const item = await itemIn(number, name);
    if (!item) continue;
    await db.update(schema.roomItems).set({ condition }).where(eq(schema.roomItems.id, item.id));
    await db.insert(schema.itemEvents).values({ itemId: item.id, kind: "condition", condition, note, staffId: desk?.id ?? by, at: new Date(`${addDaysISO(today, -2)}T10:00:00+08:00`) });
  }
  const leaver = await db.query.roomAssignments.findFirst({
    where: and(inArray(schema.roomAssignments.id, ids.assignments.length ? ids.assignments : ["00000000-0000-0000-0000-000000000000"]), isNotNull(schema.roomAssignments.actualCheckOut)),
  });
  if (leaver) {
    const roomItems = await db.select().from(schema.roomItems).where(eq(schema.roomItems.roomId, leaver.roomId));
    for (const [kind, on] of [["move_in", leaver.checkIn], ["move_out", leaver.actualCheckOut!]] as const) {
      const [check] = await db.insert(schema.inventoryChecks).values({ roomId: leaver.roomId, kind, contractId: contract.id, assignmentId: leaver.id, checkedOn: on, checkedBy: desk?.id ?? by, signedBy: kind === "move_out" ? "Signed by the tenant" : null }).returning();
      items.checks.push(check.id);
      await db.insert(schema.inventoryCheckLines).values(roomItems.map((it) => ({
        checkId: check.id, itemId: it.id,
        found: kind === "move_out" && it.name === "Key card" ? it.quantity - 1 : it.quantity,
        condition: "good" as const,
        note: kind === "move_out" && it.name === "Key card" ? "One key card not returned." : null,
      })));
    }
  }
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
    // Billing and inventory for the demo contract and demo people, including anything added while testing.
    const contracts = some(ids.contracts), people = some(ids.occupants);
    // Laundry and repair costs from testing point at charges, so they go first (claims go with their loads).
    await tx
      .delete(schema.laundryLoads)
      .where(or(inArray(schema.laundryLoads.occupantId, people), inArray(schema.laundryLoads.serviceId, some(ids.laundryServices))));
    await tx.delete(schema.laundryServices).where(inArray(schema.laundryServices.id, some(ids.laundryServices)));
    await tx.update(schema.tenantRequests).set({ chargeId: null })
      .where(or(inArray(schema.tenantRequests.occupantId, people), inArray(schema.tenantRequests.id, some(ids.requests))));
    await tx.delete(schema.inventoryChecks).where(or(
      inArray(schema.inventoryChecks.id, some(ids.items?.checks)),
      inArray(schema.inventoryChecks.contractId, contracts),
      inArray(schema.inventoryChecks.assignmentId, some(ids.assignments)),
    ));
    await tx.delete(schema.utilityBills).where(or(inArray(schema.utilityBills.id, some(ids.money?.utilityBills)), inArray(schema.utilityBills.contractId, contracts)));
    await tx.delete(schema.depositEntries).where(or(inArray(schema.depositEntries.id, some(ids.money?.deposits)), inArray(schema.depositEntries.contractId, contracts)));
    await tx.delete(schema.payments).where(or(inArray(schema.payments.id, some(ids.money?.payments)), inArray(schema.payments.contractId, contracts), inArray(schema.payments.occupantId, people)));
    await tx.delete(schema.charges).where(or(inArray(schema.charges.id, some(ids.money?.charges)), inArray(schema.charges.contractId, contracts), inArray(schema.charges.occupantId, people)));
    await tx.delete(schema.statements).where(or(inArray(schema.statements.id, some(ids.money?.statements)), inArray(schema.statements.contractId, contracts)));
    await tx.delete(schema.roomItems).where(inArray(schema.roomItems.id, some(ids.items?.roomItems)));
    await tx.delete(schema.itemTemplates).where(inArray(schema.itemTemplates.id, some(ids.items?.templates)));

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
