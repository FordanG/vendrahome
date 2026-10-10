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
// company_admin and company_staff belong to one company and see only its part.
export const staffRole = pgEnum("staff_role", ["admin", "front_desk", "maintenance", "tenant", "company_admin", "company_staff"]);

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
  // Set only for company logins: the company this login belongs to.
  clientId: uuid("client_id").references((): AnyPgColumn => clients.id, { onDelete: "cascade" }),
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
  // Regular cleaning: every this many days. Null means no regular cleaning.
  cleanEveryDays: integer("clean_every_days"),
});

// Shared spaces with their own door code: kitchen, laundry area, hallways.
// Tenants who scan one report a problem there.
export const areas = pgTable("areas", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  floor: integer("floor"),
  qrToken: text("qr_token").notNull().unique(),
  active: boolean("active").notNull().default(true),
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
  // The agreement: what this company's own logins may do.
  selfManagePeople: boolean("self_manage_people").notNull().default(true),
  approveRequests: boolean("approve_requests").notNull().default(false),
  showBilling: boolean("show_billing").notNull().default(true),
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

export const checkInPurpose = pgEnum("check_in_purpose", ["visit", "cleaning", "inventory", "checklist", "other"]);

// A staff member scanning a room's door code and confirming they are there.
// A printed code can be photographed, so this records presence, not proof of it.
export const roomCheckIns = pgTable(
  "room_check_ins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    staffId: uuid("staff_id")
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),
    visitId: uuid("visit_id").references(() => maintenanceVisits.id, { onDelete: "set null" }),
    purpose: checkInPurpose("purpose").notNull().default("other"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("check_ins_room_idx").on(t.roomId, t.at), index("check_ins_visit_idx").on(t.visitId)],
);

// Housekeeping. The checklist is one list for every room; each cleaning keeps
// its own copy of the steps, so changing the list doesn't rewrite history.
export const cleaningSteps = pgTable("cleaning_steps", {
  id: uuid("id").primaryKey().defaultRandom(),
  label: text("label").notNull(),
  position: integer("position").notNull().default(0),
});

export const cleanings = pgTable(
  "cleanings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    staffId: uuid("staff_id").references(() => staff.id, { onDelete: "set null" }),
    // The door-code check-in it started from, if any.
    checkInId: uuid("check_in_id").references(() => roomCheckIns.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    steps: jsonb("steps").$type<{ label: string; done: boolean }[]>().notNull().default([]),
    notes: text("notes"),
  },
  (t) => [index("cleanings_room_idx").on(t.roomId, t.startedAt)],
);

// issue: something wrong in the unit. maintenance and laundry: asking for a
// time outside the regular schedule, which staff approve or decline.
export const requestKind = pgEnum("request_kind", ["issue", "maintenance", "laundry"]);
export const repairPayer = pgEnum("repair_payer", ["hotel", "company", "occupant"]);
export const requestStatus = pgEnum("request_status", ["pending", "approved", "declined", "done"]);

export const tenantRequests = pgTable(
  "tenant_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // The tenant who asked. Empty when staff reported it, e.g. from a cleaning or a checklist.
    occupantId: uuid("occupant_id").references(() => occupants.id, { onDelete: "cascade" }),
    reportedBy: uuid("reported_by").references((): AnyPgColumn => staff.id, { onDelete: "set null" }),
    photoId: uuid("photo_id").references((): AnyPgColumn => photos.id),
    roomId: uuid("room_id").references(() => rooms.id, { onDelete: "set null" }),
    // Set instead of the room when the problem is in a shared space.
    areaId: uuid("area_id").references(() => areas.id, { onDelete: "set null" }),
    kind: requestKind("kind").notNull(),
    details: text("details").notNull(),
    urgent: boolean("urgent").notNull().default(false),
    preferredDate: date("preferred_date"),
    preferredTime: text("preferred_time"),
    status: requestStatus("status").notNull().default("pending"),
    // The tenant's company approves requests first; the hotel doesn't see it until then.
    awaitingCompany: boolean("awaiting_company").notNull().default(false),
    companyReviewedBy: uuid("company_reviewed_by").references((): AnyPgColumn => staff.id, { onDelete: "set null" }),
    companyReviewedAt: timestamp("company_reviewed_at", { withTimezone: true }),
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
    // What the repair cost (parts and labour) and who pays it. A company or tenant payer gets a charge.
    cost: centavos("cost"),
    paidBy: repairPayer("paid_by"),
    chargeId: uuid("charge_id").references((): AnyPgColumn => charges.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("requests_status_idx").on(t.status), index("requests_occupant_idx").on(t.occupantId)],
);

// ---------------------------------------------------------------------------
// Photos: bills, payment proofs and room items. Stored re-encoded (WebP, no
// metadata) like profile photos. `scope` decides which roles may open them.
export const photoScope = pgEnum("photo_scope", ["billing", "inventory", "laundry", "request"]);

export const photos = pgTable("photos", {
  id: uuid("id").primaryKey().defaultRandom(),
  scope: photoScope("scope").notNull(),
  data: text("data").notNull(),
  uploadedBy: uuid("uploaded_by").references(() => staff.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Billing. Every amount owed is a row in `charges` and every amount received a
// row in `payments`, for either a company (through its contract) or one tenant.
// Rows are never edited or deleted once money depends on them: a mistake gets a
// reversing row (negative amount, `reversesId` set).

export const billTo = pgEnum("bill_to", ["company", "occupant"]);

// `code` marks the kinds the app itself creates (rent, utilities, damage...).
export const chargeTypes = pgTable("charge_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").unique(),
  name: text("name").notNull().unique(),
  defaultBillTo: billTo("default_bill_to").notNull().default("company"),
  active: boolean("active").notNull().default(true),
  position: integer("position").notNull().default(0),
});

// Who pays each kind of charge under one contract, when it differs from the default.
export const contractChargeRules = pgTable(
  "contract_charge_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contractId: uuid("contract_id").notNull().references(() => contracts.id, { onDelete: "cascade" }),
    chargeTypeId: uuid("charge_type_id").notNull().references(() => chargeTypes.id, { onDelete: "cascade" }),
    billTo: billTo("bill_to").notNull(),
  },
  (t) => [uniqueIndex("contract_charge_rules_unique").on(t.contractId, t.chargeTypeId)],
);

// A company statement for one contract month. Frozen once issued.
export const statements = pgTable(
  "statements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contractId: uuid("contract_id").notNull().references(() => contracts.id),
    number: text("number").notNull().unique(),
    rentMonth: integer("rent_month").notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    issuedOn: date("issued_on").notNull(),
    dueDate: date("due_date").notNull(),
    previousBalance: centavos("previous_balance").notNull(),
    newCharges: centavos("new_charges").notNull(),
    paymentsReceived: centavos("payments_received").notNull(),
    balanceDue: centavos("balance_due").notNull(),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => staff.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("statements_contract_month").on(t.contractId, t.rentMonth)],
);

export const charges = pgTable(
  "charges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chargeTypeId: uuid("charge_type_id").notNull().references(() => chargeTypes.id),
    billTo: billTo("bill_to").notNull(),
    // The company account. Also kept on tenant charges for context.
    contractId: uuid("contract_id").references(() => contracts.id),
    // The tenant account, or for company charges the tenant it was for (itemized).
    occupantId: uuid("occupant_id").references(() => occupants.id),
    roomId: uuid("room_id").references(() => rooms.id, { onDelete: "set null" }),
    description: text("description").notNull(),
    amount: centavos("amount").notNull(),
    chargedOn: date("charged_on").notNull(),
    // Rent charges: the contract month they are for.
    rentMonth: integer("rent_month"),
    // Company charges: the statement they appear on (null = not billed yet).
    statementId: uuid("statement_id").references(() => statements.id),
    reversesId: uuid("reverses_id").references((): AnyPgColumn => charges.id),
    createdBy: uuid("created_by").references(() => staff.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("charges_contract_idx").on(t.contractId),
    index("charges_occupant_idx").on(t.occupantId),
    uniqueIndex("charges_one_rent_per_month").on(t.contractId, t.rentMonth).where(sql`${t.rentMonth} IS NOT NULL AND ${t.reversesId} IS NULL`),
    uniqueIndex("charges_reversed_once").on(t.reversesId).where(sql`${t.reversesId} IS NOT NULL`),
  ],
);

export const paymentMethod = pgEnum("payment_method", ["cash", "bank_transfer", "gcash", "maya", "check", "other"]);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    billTo: billTo("bill_to").notNull(),
    contractId: uuid("contract_id").references(() => contracts.id),
    occupantId: uuid("occupant_id").references(() => occupants.id),
    amount: centavos("amount").notNull(),
    method: paymentMethod("method").notNull(),
    reference: text("reference"),
    receivedOn: date("received_on").notNull(),
    // Number of the official receipt from the hotel's own system, if one was issued.
    officialReceiptNo: text("official_receipt_no"),
    proofPhotoId: uuid("proof_photo_id").references(() => photos.id),
    notes: text("notes"),
    // Company payments: the statement that counted it (null = after the latest statement).
    statementId: uuid("statement_id").references(() => statements.id),
    reversesId: uuid("reverses_id").references((): AnyPgColumn => payments.id),
    createdBy: uuid("created_by").references(() => staff.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("payments_contract_idx").on(t.contractId),
    index("payments_occupant_idx").on(t.occupantId),
    uniqueIndex("payments_reversed_once").on(t.reversesId).where(sql`${t.reversesId} IS NOT NULL`),
  ],
);

// Security deposit held for a contract: received, then deductions and refunds at handover.
export const depositEntryKind = pgEnum("deposit_entry_kind", ["received", "deduction", "refund"]);

export const depositEntries = pgTable("deposit_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  contractId: uuid("contract_id").notNull().references(() => contracts.id),
  kind: depositEntryKind("kind").notNull(),
  amount: centavos("amount").notNull(),
  entryOn: date("entry_on").notNull(),
  description: text("description").notNull(),
  roomItemId: uuid("room_item_id").references((): AnyPgColumn => roomItems.id, { onDelete: "set null" }),
  checkId: uuid("check_id").references((): AnyPgColumn => inventoryChecks.id, { onDelete: "set null" }),
  reversesId: uuid("reverses_id").references((): AnyPgColumn => depositEntries.id),
  createdBy: uuid("created_by").references(() => staff.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("deposit_reversed_once").on(t.reversesId).where(sql`${t.reversesId} IS NOT NULL`)]);

// Utilities: one bill for the whole contract each period, from the provider's
// bill or a main-meter reading. Readings are stored in thousandths of a unit and
// rates in ten-thousandths of a peso per unit, so nothing is rounded early.
export const utilityMethod = pgEnum("utility_method", ["bill", "meter"]);

export const utilityTypes = pgTable("utility_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  provider: text("provider"),
  unit: text("unit"),
  defaultMethod: utilityMethod("default_method").notNull().default("bill"),
  rate: bigint("rate", { mode: "number" }),
  active: boolean("active").notNull().default(true),
  position: integer("position").notNull().default(0),
});

export const utilityBills = pgTable(
  "utility_bills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    utilityTypeId: uuid("utility_type_id").notNull().references(() => utilityTypes.id),
    contractId: uuid("contract_id").notNull().references(() => contracts.id),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    dueDate: date("due_date"),
    method: utilityMethod("method").notNull(),
    previousReading: bigint("previous_reading", { mode: "number" }),
    currentReading: bigint("current_reading", { mode: "number" }),
    rate: bigint("rate", { mode: "number" }),
    amount: centavos("amount").notNull(),
    photoId: uuid("photo_id").references(() => photos.id),
    notes: text("notes"),
    chargeId: uuid("charge_id").references(() => charges.id),
    createdBy: uuid("created_by").references(() => staff.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // One bill per utility, contract and period unless the earlier one was reversed (checked in code).
  (t) => [index("utility_bills_contract_idx").on(t.contractId, t.utilityTypeId)],
);

// ---------------------------------------------------------------------------
// Room inventory. Items belong to a room (or the storeroom when roomId is null).
// Checks record what was found, item by item, so damage can be traced to a stay.

export const itemCategory = pgEnum("item_category", ["furniture", "appliance", "fixture", "issued"]);
export const itemCondition = pgEnum("item_condition", ["good", "fair", "damaged", "missing"]);

// The standard list of items for a room type, used to set up rooms quickly.
export const itemTemplates = pgTable("item_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  roomTypeId: uuid("room_type_id").notNull().references(() => roomTypes.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  category: itemCategory("category").notNull(),
  quantity: integer("quantity").notNull().default(1),
  replacementCost: centavos("replacement_cost").notNull().default(0),
  serviceEveryMonths: integer("service_every_months"),
  position: integer("position").notNull().default(0),
});

export const roomItems = pgTable(
  "room_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id").references(() => rooms.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    category: itemCategory("category").notNull(),
    quantity: integer("quantity").notNull().default(1),
    brand: text("brand"),
    model: text("model"),
    serialNumber: text("serial_number"),
    tagCode: text("tag_code").unique(),
    purchaseDate: date("purchase_date"),
    purchaseCost: centavos("purchase_cost"),
    replacementCost: centavos("replacement_cost").notNull().default(0),
    condition: itemCondition("condition").notNull().default("good"),
    serviceEveryMonths: integer("service_every_months"),
    lastServicedOn: date("last_serviced_on"),
    photoId: uuid("photo_id").references(() => photos.id),
    retiredOn: date("retired_on"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("room_items_room_idx").on(t.roomId)],
);

export const inventoryCheckKind = pgEnum("inventory_check_kind", ["contract_start", "move_in", "move_out", "spot", "handover"]);

export const inventoryChecks = pgTable(
  "inventory_checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id").notNull().references(() => rooms.id),
    kind: inventoryCheckKind("kind").notNull(),
    contractId: uuid("contract_id").references(() => contracts.id, { onDelete: "set null" }),
    // Move-in and move-out checks: the stay they belong to.
    assignmentId: uuid("assignment_id").references(() => roomAssignments.id, { onDelete: "set null" }),
    checkedOn: date("checked_on").notNull(),
    checkedBy: uuid("checked_by").references(() => staff.id, { onDelete: "set null" }),
    // Who signed it off for the company or the tenant, as written on the sheet.
    signedBy: text("signed_by"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("checks_room_idx").on(t.roomId)],
);

export const inventoryCheckLines = pgTable(
  "inventory_check_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    checkId: uuid("check_id").notNull().references(() => inventoryChecks.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").notNull().references(() => roomItems.id, { onDelete: "cascade" }),
    // How many were found (the item's quantity is how many there should be).
    found: integer("found").notNull(),
    condition: itemCondition("condition").notNull(),
    note: text("note"),
    photoId: uuid("photo_id").references(() => photos.id),
    // Set once the difference was charged to someone or deducted from the deposit.
    chargeId: uuid("charge_id").references(() => charges.id),
    depositEntryId: uuid("deposit_entry_id").references(() => depositEntries.id),
  },
  (t) => [uniqueIndex("check_lines_unique").on(t.checkId, t.itemId)],
);

export const itemEventKind = pgEnum("item_event_kind", ["added", "updated", "condition", "moved", "serviced", "retired"]);

export const itemEvents = pgTable(
  "item_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id").notNull().references(() => roomItems.id, { onDelete: "cascade" }),
    kind: itemEventKind("kind").notNull(),
    fromRoomId: uuid("from_room_id").references(() => rooms.id, { onDelete: "set null" }),
    toRoomId: uuid("to_room_id").references(() => rooms.id, { onDelete: "set null" }),
    condition: itemCondition("condition"),
    note: text("note"),
    checkId: uuid("check_id").references(() => inventoryChecks.id, { onDelete: "set null" }),
    staffId: uuid("staff_id").references(() => staff.id, { onDelete: "set null" }),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("item_events_item_idx").on(t.itemId)],
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
export type RoomCheckIn = typeof roomCheckIns.$inferSelect;
export type CheckInPurpose = (typeof checkInPurpose.enumValues)[number];
export type Cleaning = typeof cleanings.$inferSelect;
export type Area = typeof areas.$inferSelect;
export type TenantRequest = typeof tenantRequests.$inferSelect;
export type ChargeType = typeof chargeTypes.$inferSelect;
export type Charge = typeof charges.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type Statement = typeof statements.$inferSelect;
export type DepositEntry = typeof depositEntries.$inferSelect;
export type UtilityType = typeof utilityTypes.$inferSelect;
export type UtilityBill = typeof utilityBills.$inferSelect;
export type ItemTemplate = typeof itemTemplates.$inferSelect;
export type RoomItem = typeof roomItems.$inferSelect;
export type InventoryCheck = typeof inventoryChecks.$inferSelect;
export type InventoryCheckLine = typeof inventoryCheckLines.$inferSelect;
export type ItemCondition = (typeof itemCondition.enumValues)[number];
export type ItemCategory = (typeof itemCategory.enumValues)[number];
export type InventoryCheckKind = (typeof inventoryCheckKind.enumValues)[number];
export type PaymentMethod = (typeof paymentMethod.enumValues)[number];

// ---------------------------------------------------------------------------
// Laundry. Tenants drop bags at the front desk; the desk sends them to the
// outside shop, enters the weight from the shop's slip when they come back
// (which adds the charge), and hands them back to the tenant.
export const laundryServices = pgTable("laundry_services", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  // What the tenant or company pays, and what the shop charges the hotel, per kilo.
  ratePerKilo: centavos("rate_per_kilo").notNull(),
  costPerKilo: centavos("cost_per_kilo"),
  minimumCharge: centavos("minimum_charge"),
  turnaroundDays: integer("turnaround_days").notNull().default(2),
  active: boolean("active").notNull().default(true),
  position: integer("position").notNull().default(0),
});

export const laundryStatus = pgEnum("laundry_status", ["at_desk", "at_shop", "ready", "collected", "cancelled"]);

export const laundryLoads = pgTable(
  "laundry_loads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Written on the bag's tag so the desk, the shop and the tenant mean the same bag.
    number: integer("number").generatedAlwaysAsIdentity().notNull().unique(),
    occupantId: uuid("occupant_id")
      .notNull()
      .references(() => occupants.id),
    roomId: uuid("room_id").references(() => rooms.id, { onDelete: "set null" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => laundryServices.id),
    bags: integer("bags").notNull().default(1),
    status: laundryStatus("status").notNull().default("at_desk"),
    notes: text("notes"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    receivedBy: uuid("received_by").references(() => staff.id, { onDelete: "set null" }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    returnedAt: timestamp("returned_at", { withTimezone: true }),
    // From the shop's slip. Grams, so 3.25 kg is 3250.
    grams: integer("grams"),
    amount: centavos("amount"),
    cost: centavos("cost"),
    chargeId: uuid("charge_id").references(() => charges.id),
    collectedAt: timestamp("collected_at", { withTimezone: true }),
    handledBy: uuid("handled_by").references(() => staff.id, { onDelete: "set null" }),
  },
  (t) => [index("laundry_status_idx").on(t.status), index("laundry_occupant_idx").on(t.occupantId)],
);

export const claimKind = pgEnum("laundry_claim_kind", ["missing", "damaged"]);
export const claimStatus = pgEnum("laundry_claim_status", ["open", "resolved"]);

// Clothes that came back missing or damaged. Reported by the tenant or the desk.
export const laundryClaims = pgTable("laundry_claims", {
  id: uuid("id").primaryKey().defaultRandom(),
  loadId: uuid("load_id")
    .notNull()
    .references(() => laundryLoads.id, { onDelete: "cascade" }),
  kind: claimKind("kind").notNull(),
  details: text("details").notNull(),
  photoId: uuid("photo_id").references(() => photos.id),
  status: claimStatus("status").notNull().default("open"),
  resolution: text("resolution"),
  reportedBy: uuid("reported_by").references(() => staff.id, { onDelete: "set null" }),
  resolvedBy: uuid("resolved_by").references(() => staff.id, { onDelete: "set null" }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type LaundryService = typeof laundryServices.$inferSelect;
export type LaundryLoad = typeof laundryLoads.$inferSelect;
export type LaundryStatus = (typeof laundryStatus.enumValues)[number];
export type LaundryClaim = typeof laundryClaims.$inferSelect;

// ---------------------------------------------------------------------------
// Recurring maintenance checklists (aircon filter, smoke detector...), each on
// its own cycle for every room. A failed item becomes a staff-reported request.
export const maintenanceChecklists = pgTable("maintenance_checklists", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  everyDays: integer("every_days").notNull(),
  items: jsonb("items").$type<string[]>().notNull().default([]),
  active: boolean("active").notNull().default(true),
});

export type ChecklistResult = { label: string; result: "ok" | "fail" | "na" | null; note: string | null };

export const checklistRuns = pgTable(
  "checklist_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    checklistId: uuid("checklist_id")
      .notNull()
      .references(() => maintenanceChecklists.id, { onDelete: "cascade" }),
    staffId: uuid("staff_id").references(() => staff.id, { onDelete: "set null" }),
    checkInId: uuid("check_in_id").references(() => roomCheckIns.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    // A copy of the items when it started, with what was found.
    results: jsonb("results").$type<ChecklistResult[]>().notNull().default([]),
  },
  (t) => [index("checklist_runs_room_idx").on(t.roomId, t.checklistId)],
);

// ---------------------------------------------------------------------------
// Tenants rate a cleaning of their room, a repair visit or a laundry load.
export const feedbackTopic = pgEnum("feedback_topic", ["cleaning", "repair", "laundry"]);

export const feedback = pgTable(
  "feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    occupantId: uuid("occupant_id")
      .notNull()
      .references(() => occupants.id, { onDelete: "cascade" }),
    topic: feedbackTopic("topic").notNull(),
    // The cleaning, visit or laundry load being rated.
    subjectId: uuid("subject_id").notNull(),
    roomId: uuid("room_id").references(() => rooms.id, { onDelete: "set null" }),
    stars: integer("stars").notNull(),
    comment: text("comment"),
    // Ratings of 3 or lower stay flagged until someone writes a follow-up.
    followUp: text("follow_up"),
    followedUpBy: uuid("followed_up_by").references(() => staff.id, { onDelete: "set null" }),
    followedUpAt: timestamp("followed_up_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("feedback_once").on(t.occupantId, t.subjectId)],
);

export type MaintenanceChecklist = typeof maintenanceChecklists.$inferSelect;
export type ChecklistRun = typeof checklistRuns.$inferSelect;
export type Feedback = typeof feedback.$inferSelect;
export type FeedbackTopic = (typeof feedbackTopic.enumValues)[number];

// ---------------------------------------------------------------------------
// Company accounts ask for move-ins and move-outs; the front desk does them,
// because the desk hands over keys and checks the room's items.
export const stayRequestKind = pgEnum("stay_request_kind", ["move_in", "move_out"]);
export const stayRequestStatus = pgEnum("stay_request_status", ["pending", "done", "declined", "cancelled"]);

export const stayRequests = pgTable(
  "stay_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    kind: stayRequestKind("kind").notNull(),
    occupantId: uuid("occupant_id").notNull().references(() => occupants.id, { onDelete: "cascade" }),
    // Move-ins: the room asked for. Move-outs: the room they leave.
    roomId: uuid("room_id").references(() => rooms.id, { onDelete: "set null" }),
    slot: text("slot"),
    date: date("date").notNull(),
    expectedCheckOut: date("expected_check_out"),
    note: text("note"),
    status: stayRequestStatus("status").notNull().default("pending"),
    requestedBy: uuid("requested_by").references(() => staff.id, { onDelete: "set null" }),
    handledBy: uuid("handled_by").references(() => staff.id, { onDelete: "set null" }),
    handledAt: timestamp("handled_at", { withTimezone: true }),
    response: text("response"),
    assignmentId: uuid("assignment_id").references(() => roomAssignments.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("stay_requests_client_idx").on(t.clientId),
    // One open ask per person at a time.
    uniqueIndex("stay_requests_one_pending").on(t.occupantId).where(sql`${t.status} = 'pending'`),
  ],
);

export type StayRequest = typeof stayRequests.$inferSelect;
