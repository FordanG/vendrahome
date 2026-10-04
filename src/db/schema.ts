import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  bigint,
  boolean,
  date,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

// Money is always stored in whole centavos.
const centavos = (name: string) => bigint(name, { mode: "number" });

// front_desk also covers housekeeping for now.
// tenant is an occupant's own login; it sees only their own stay.
export const staffRole = pgEnum("staff_role", ["admin", "front_desk", "maintenance", "tenant"]);

// Every login lives here, staff and tenants alike.
export const staff = pgTable("staff", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: staffRole("role").notNull(),
  // Set only for tenant logins: the occupant this login belongs to.
  occupantId: uuid("occupant_id")
    .unique()
    .references((): AnyPgColumn => occupants.id, { onDelete: "cascade" }),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const accountPhotos = pgTable("account_photos", {
  staffId: uuid("staff_id").primaryKey().references(() => staff.id, { onDelete: "cascade" }),
  data: text("data").notNull(),
  version: uuid("version").notNull().defaultRandom(),
});

export const sessions = pgTable("sessions", {
  // sha256 of the cookie token, never the token itself
  id: text("id").primaryKey(),
  staffId: uuid("staff_id")
    .notNull()
    .references(() => staff.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const loginAttempts = pgTable("login_attempts", {
  key: text("key").primaryKey(),
  attempts: integer("attempts").notNull().default(0),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull().defaultNow(),
});

export const roomTypes = pgTable("room_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  defaultCapacity: integer("default_capacity").notNull().default(1),
  notes: text("notes"),
});

// Occupied / contracted / vacant are derived from contracts and assignments.
// This column only holds states staff set by hand.
export const roomCondition = pgEnum("room_condition", [
  "ready",
  "needs_work",
  "not_available",
]);

export const rooms = pgTable("rooms", {
  id: uuid("id").primaryKey().defaultRandom(),
  number: text("number").notNull().unique(),
  floor: integer("floor").notNull(),
  roomTypeId: uuid("room_type_id").references(() => roomTypes.id, { onDelete: "set null" }),
  capacity: integer("capacity").notNull().default(1),
  condition: roomCondition("condition").notNull().default("ready"),
  notes: text("notes"),
  qrToken: text("qr_token").notNull().unique(),
});

export const clients = pgTable("clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  tin: text("tin"),
  address: text("address"),
  contactName: text("contact_name"),
  contactPhone: text("contact_phone"),
  contactEmail: text("contact_email"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const partialMonthPolicy = pgEnum("partial_month_policy", ["full", "prorated"]);

export const rentType = pgEnum("rent_type", ["total", "per_room"]);
export const contractStatus = pgEnum("contract_status", [
  "draft",
  "active",
  "ended",
  "terminated",
]);

export const contracts = pgTable("contracts", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id),
  reference: text("reference").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  rentType: rentType("rent_type").notNull().default("total"),
  // Used when rentType = total. Per-room rates live on contract_rooms.
  monthlyRent: centavos("monthly_rent").notNull().default(0),
  deposit: centavos("deposit").notNull().default(0),
  advance: centavos("advance").notNull().default(0),
  billingDay: integer("billing_day").notNull().default(1),
  partialMonthPolicy: partialMonthPolicy("partial_month_policy").notNull().default("full"),
  paymentTerms: text("payment_terms"),
  notes: text("notes"),
  status: contractStatus("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const contractRooms = pgTable(
  "contract_rooms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id),
    monthlyRate: centavos("monthly_rate"),
  },
  (t) => [uniqueIndex("contract_rooms_unique").on(t.contractId, t.roomId)],
);

export const rentStepKind = pgEnum("rent_step_kind", ["amount", "percent"]);

// From contract month `startMonth` (1 = first month), rent becomes `value`
// centavos (amount) or rises by `value` basis points (percent, compounding).
export const rentSteps = pgTable("rent_steps", {
  id: uuid("id").primaryKey().defaultRandom(),
  contractId: uuid("contract_id")
    .notNull()
    .references(() => contracts.id, { onDelete: "cascade" }),
  startMonth: integer("start_month").notNull(),
  kind: rentStepKind("kind").notNull(),
  value: centavos("value").notNull(),
  note: text("note"),
}, (t) => [uniqueIndex("rent_steps_contract_month_unique").on(t.contractId, t.startMonth)]);

export const occupantStatus = pgEnum("occupant_status", ["active", "inactive"]);

export const occupants = pgTable(
  "occupants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
    // Identity
    fullName: text("full_name").notNull(),
    nickname: text("nickname"),
    sex: text("sex"),
    birthDate: date("birth_date"),
    nationality: text("nationality"),
    civilStatus: text("civil_status"),
    // Contact
    mobile: text("mobile"),
    email: text("email"),
    homeAddress: text("home_address"),
    // Work
    employeeId: text("employee_id"),
    position: text("position"),
    department: text("department"),
    shift: text("shift"),
    // ID (admin and front desk only)
    idType: text("id_type"),
    idNumber: text("id_number"),
    // Emergency
    emergencyName: text("emergency_name"),
    emergencyRelationship: text("emergency_relationship"),
    emergencyMobile: text("emergency_mobile"),
    // Other
    specialNeeds: text("special_needs"),
    vehicle: text("vehicle"),
    notes: text("notes"),
    status: occupantStatus("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("occupants_name_idx").on(t.fullName)],
);

export const roomAssignments = pgTable(
  "room_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    occupantId: uuid("occupant_id")
      .notNull()
      .references(() => occupants.id, { onDelete: "cascade" }),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id),
    contractId: uuid("contract_id").references(() => contracts.id, { onDelete: "set null" }),
    slot: text("slot"),
    checkIn: date("check_in").notNull(),
    expectedCheckOut: date("expected_check_out"),
    actualCheckOut: date("actual_check_out"),
    keysIssued: text("keys_issued"),
    assignedBy: uuid("assigned_by").references(() => staff.id, { onDelete: "set null" }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("assignments_room_idx").on(t.roomId),
    index("assignments_occupant_idx").on(t.occupantId),
    uniqueIndex("assignments_one_open_stay").on(t.occupantId).where(sql`${t.actualCheckOut} IS NULL`),
    uniqueIndex("assignments_open_slot").on(t.roomId, sql`lower(trim(${t.slot}))`).where(sql`${t.actualCheckOut} IS NULL AND ${t.slot} IS NOT NULL`),
  ],
);

export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  staffId: uuid("staff_id").references(() => staff.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: text("entity_id"),
  detail: jsonb("detail"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

export const houseRules = pgTable("house_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  body: text("body"),
  position: integer("position").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Weekly timetable for shared things: kitchen use and the regular laundry pickup.
// An entry covers every room, one floor (floor set) or one room (roomId set).
export const scheduleKind = pgEnum("schedule_kind", ["kitchen", "laundry"]);

export const weeklySchedule = pgTable("weekly_schedule", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: scheduleKind("kind").notNull(),
  // ISO weekday: 1 = Monday ... 7 = Sunday
  weekday: integer("weekday").notNull(),
  // "HH:MM", 24-hour
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  floor: integer("floor"),
  roomId: uuid("room_id").references(() => rooms.id, { onDelete: "cascade" }),
  note: text("note"),
});

export const visitStatus = pgEnum("visit_status", ["scheduled", "done", "missed", "cancelled"]);

export const maintenanceVisits = pgTable(
  "maintenance_visits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    date: date("date").notNull(),
    timeFrom: text("time_from"),
    timeTo: text("time_to"),
    notes: text("notes"),
    status: visitStatus("status").notNull().default("scheduled"),
    // Set when the visit came from an approved tenant request.
    requestId: uuid("request_id").references((): AnyPgColumn => tenantRequests.id, { onDelete: "set null" }),
    assigneeId: uuid("assignee_id").references(() => staff.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => staff.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("visits_date_idx").on(t.date), index("visits_room_idx").on(t.roomId)],
);

// issue: something wrong in the unit. maintenance and laundry: asking for a
// time outside the regular schedule, which staff approve or decline.
export const requestKind = pgEnum("request_kind", ["issue", "maintenance", "laundry"]);
export const requestStatus = pgEnum("request_status", ["pending", "approved", "declined", "done"]);

export const tenantRequests = pgTable(
  "tenant_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    occupantId: uuid("occupant_id")
      .notNull()
      .references(() => occupants.id, { onDelete: "cascade" }),
    roomId: uuid("room_id").references(() => rooms.id, { onDelete: "set null" }),
    kind: requestKind("kind").notNull(),
    details: text("details").notNull(),
    urgent: boolean("urgent").notNull().default(false),
    preferredDate: date("preferred_date"),
    preferredTime: text("preferred_time"),
    status: requestStatus("status").notNull().default("pending"),
    // What staff set when approving
    scheduledDate: date("scheduled_date"),
    scheduledFrom: text("scheduled_from"),
    scheduledTo: text("scheduled_to"),
    response: text("response"),
    assigneeId: uuid("assignee_id").references(() => staff.id, { onDelete: "set null" }),
  dueDate: date("due_date"),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  handledBy: uuid("handled_by").references(() => staff.id, { onDelete: "set null" }),
    handledAt: timestamp("handled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("requests_status_idx").on(t.status), index("requests_occupant_idx").on(t.occupantId)],
);

export type Staff = typeof staff.$inferSelect;
export type StaffRole = (typeof staffRole.enumValues)[number];
export type Room = typeof rooms.$inferSelect;
export type Client = typeof clients.$inferSelect;
export type Contract = typeof contracts.$inferSelect;
export type RentStep = typeof rentSteps.$inferSelect;
export type Occupant = typeof occupants.$inferSelect;
export type RoomAssignment = typeof roomAssignments.$inferSelect;
export type HouseRule = typeof houseRules.$inferSelect;
export type ScheduleEntry = typeof weeklySchedule.$inferSelect;
export type MaintenanceVisit = typeof maintenanceVisits.$inferSelect;
export type TenantRequest = typeof tenantRequests.$inferSelect;
