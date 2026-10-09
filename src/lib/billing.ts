import "server-only";
import { and, asc, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Contract, PaymentMethod } from "@/db/schema";
import { addDaysISO, daysBetween, formatDate } from "./format";
import { contractMonthPeriod, contractMonths, rentChargeForMonth } from "./rent";

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  bank_transfer: "Bank transfer",
  gcash: "GCash",
  maya: "Maya",
  check: "Check",
  other: "Other",
};

export const BILL_TO_LABELS = { company: "Company", occupant: "Tenant" } as const;

/** Monthly rent before increases: the contract amount, or the room rates added up. */
export async function contractRentBase(contract: Contract): Promise<{ base: number; missingRates: number }> {
  if (contract.rentType !== "per_room") return { base: contract.monthlyRent, missingRates: 0 };
  const db = await getDb();
  const rates = await db
    .select({ rate: schema.contractRooms.monthlyRate })
    .from(schema.contractRooms)
    .where(eq(schema.contractRooms.contractId, contract.id));
  return {
    base: rates.reduce((sum, r) => sum + (r.rate ?? 0), 0),
    missingRates: rates.filter((r) => r.rate == null).length,
  };
}

export async function chargeTypeByCode(code: string) {
  const db = await getDb();
  const type = await db.query.chargeTypes.findFirst({ where: eq(schema.chargeTypes.code, code) });
  if (!type) throw new Error(`Charge type "${code}" is missing. Run the latest database migration.`);
  return type;
}

/** Who pays this kind of charge under this contract: its rule, or the charge type's default. */
export async function billToFor(contractId: string | null, chargeTypeId: string): Promise<"company" | "occupant"> {
  const db = await getDb();
  if (contractId) {
    const rule = await db.query.contractChargeRules.findFirst({
      where: and(eq(schema.contractChargeRules.contractId, contractId), eq(schema.contractChargeRules.chargeTypeId, chargeTypeId)),
    });
    if (rule) return rule.billTo;
  }
  const type = await db.query.chargeTypes.findFirst({ where: eq(schema.chargeTypes.id, chargeTypeId) });
  return type?.defaultBillTo ?? "company";
}

/** The contract a tenant's stay was under on `date`, for charges that go to their company. */
export async function contractForOccupant(occupantId: string, date: string): Promise<string | null> {
  const db = await getDb();
  const stays = await db
    .select({ contractId: schema.roomAssignments.contractId, checkIn: schema.roomAssignments.checkIn, out: schema.roomAssignments.actualCheckOut })
    .from(schema.roomAssignments)
    .where(eq(schema.roomAssignments.occupantId, occupantId))
    .orderBy(desc(schema.roomAssignments.checkIn));
  const stay = stays.find((s) => s.checkIn <= date && (!s.out || s.out >= date)) ?? stays[0];
  return stay?.contractId ?? null;
}

const sum = (rows: { amount: number }[]) => rows.reduce((n, r) => n + r.amount, 0);

/** The next contract month to bill, or null when every month has a statement. */
export async function nextStatementMonth(contract: Contract): Promise<number | null> {
  const db = await getDb();
  const [{ last }] = await db
    .select({ last: sql<number | null>`max(${schema.statements.rentMonth})` })
    .from(schema.statements)
    .where(eq(schema.statements.contractId, contract.id));
  const next = (last ?? 0) + 1;
  return next <= contractMonths(contract.startDate, contract.endDate) ? next : null;
}

export type LedgerCharge = Awaited<ReturnType<typeof chargeRows>>[number];
export type LedgerPayment = Awaited<ReturnType<typeof paymentRows>>[number];

async function chargeRows(where: ReturnType<typeof and>) {
  const db = await getDb();
  const rows = await db
    .select({
      charge: schema.charges,
      typeName: schema.chargeTypes.name,
      typeCode: schema.chargeTypes.code,
      roomNumber: schema.rooms.number,
      occupantName: schema.occupants.fullName,
      statementNumber: schema.statements.number,
    })
    .from(schema.charges)
    .innerJoin(schema.chargeTypes, eq(schema.charges.chargeTypeId, schema.chargeTypes.id))
    .leftJoin(schema.rooms, eq(schema.charges.roomId, schema.rooms.id))
    .leftJoin(schema.occupants, eq(schema.charges.occupantId, schema.occupants.id))
    .leftJoin(schema.statements, eq(schema.charges.statementId, schema.statements.id))
    .where(where)
    .orderBy(asc(schema.charges.chargedOn), asc(schema.charges.createdAt));
  const reversed = new Set(rows.map((r) => r.charge.reversesId).filter(Boolean));
  return rows.map((r) => ({ ...r, reversed: reversed.has(r.charge.id) }));
}

async function paymentRows(where: ReturnType<typeof and>) {
  const db = await getDb();
  const rows = await db
    .select({ payment: schema.payments, statementNumber: schema.statements.number })
    .from(schema.payments)
    .leftJoin(schema.statements, eq(schema.payments.statementId, schema.statements.id))
    .where(where)
    .orderBy(asc(schema.payments.receivedOn), asc(schema.payments.createdAt));
  const reversed = new Set(rows.map((r) => r.payment.reversesId).filter(Boolean));
  return rows.map((r) => ({ ...r, reversed: reversed.has(r.payment.id) }));
}

/**
 * What the company owes under one contract. Charges and payments are the record;
 * statements are frozen summaries of them, issued month by month.
 */
export async function companyAccount(contractId: string, today: string) {
  const db = await getDb();
  const [charges, payments, statements, deposits] = await Promise.all([
    chargeRows(and(eq(schema.charges.contractId, contractId), eq(schema.charges.billTo, "company"))),
    paymentRows(and(eq(schema.payments.contractId, contractId), eq(schema.payments.billTo, "company"))),
    db.select().from(schema.statements).where(eq(schema.statements.contractId, contractId)).orderBy(asc(schema.statements.rentMonth)),
    db.select().from(schema.depositEntries).where(eq(schema.depositEntries.contractId, contractId)).orderBy(asc(schema.depositEntries.entryOn), asc(schema.depositEntries.createdAt)),
  ]);
  const totalCharged = sum(charges.map((c) => c.charge));
  const totalPaid = sum(payments.map((p) => p.payment));
  const unbilled = charges.filter((c) => !c.charge.statementId);
  const unappliedPayments = payments.filter((p) => !p.payment.statementId);
  return {
    charges,
    payments,
    statements,
    balance: totalCharged - totalPaid,
    unbilled,
    unbilledTotal: sum(unbilled.map((c) => c.charge)),
    unappliedTotal: sum(unappliedPayments.map((p) => p.payment)),
    overdue: overdueFrom(statements, charges, totalPaid, today),
    deposit: { entries: deposits, held: depositHeld(deposits) },
  };
}

export function depositHeld(entries: { kind: "received" | "deduction" | "refund"; amount: number }[]) {
  return entries.reduce((n, e) => n + (e.kind === "received" ? e.amount : -e.amount), 0);
}

/**
 * Payments clear the oldest statements first. Whatever is still owed on statements
 * whose due date has passed is overdue, counted from the oldest of them.
 */
function overdueFrom(
  statements: { id: string; dueDate: string; number: string }[],
  charges: { charge: { statementId: string | null; amount: number } }[],
  totalPaid: number,
  today: string,
): { amount: number; since: string; days: number; statementNumber: string } | null {
  let paidLeft = totalPaid;
  let oldest: (typeof statements)[number] | null = null;
  let amount = 0;
  for (const s of statements) {
    const onThis = sum(charges.filter((c) => c.charge.statementId === s.id).map((c) => c.charge));
    const covered = Math.min(Math.max(paidLeft, 0), onThis);
    paidLeft -= covered;
    const owed = onThis - covered;
    if (owed > 0 && s.dueDate < today) {
      oldest ??= s;
      amount += owed;
    }
  }
  if (!oldest || amount <= 0) return null;
  return { amount, since: oldest.dueDate, days: daysBetween(oldest.dueDate, today), statementNumber: oldest.number };
}

/** What the next statement would contain if issued on `issuedOn`. Nothing is saved. */
export async function statementDraft(contract: Contract, issuedOn: string) {
  const month = await nextStatementMonth(contract);
  if (!month) return null;
  const db = await getDb();
  const period = contractMonthPeriod(contract.startDate, contract.endDate, month);
  const [{ base, missingRates }, steps, unbilled, unapplied, previous] = await Promise.all([
    contractRentBase(contract),
    db.select().from(schema.rentSteps).where(eq(schema.rentSteps.contractId, contract.id)),
    chargeRows(and(
      eq(schema.charges.contractId, contract.id),
      eq(schema.charges.billTo, "company"),
      isNull(schema.charges.statementId),
      lte(schema.charges.chargedOn, issuedOn),
    )),
    paymentRows(and(
      eq(schema.payments.contractId, contract.id),
      eq(schema.payments.billTo, "company"),
      isNull(schema.payments.statementId),
      lte(schema.payments.receivedOn, issuedOn),
    )),
    db.query.statements.findFirst({ where: eq(schema.statements.contractId, contract.id), orderBy: desc(schema.statements.rentMonth) }),
  ]);
  const rent = rentChargeForMonth(base, steps, contract.startDate, contract.endDate, contract.partialMonthPolicy, month);
  const previousBalance = previous?.balanceDue ?? 0;
  const newCharges = rent + sum(unbilled.map((c) => c.charge));
  const paymentsReceived = sum(unapplied.map((p) => p.payment));
  return {
    month,
    period,
    rent,
    rentDescription: `Rent, month ${month} (${formatDate(period.start)} – ${formatDate(period.end)})`,
    missingRates,
    charges: unbilled,
    payments: unapplied,
    previousBalance,
    newCharges,
    paymentsReceived,
    balanceDue: previousBalance + newCharges - paymentsReceived,
  };
}

/** A tenant's own account: charges billed to them and what they paid. */
export async function occupantAccount(occupantId: string) {
  const [charges, payments] = await Promise.all([
    chargeRows(and(eq(schema.charges.occupantId, occupantId), eq(schema.charges.billTo, "occupant"))),
    paymentRows(and(eq(schema.payments.occupantId, occupantId), eq(schema.payments.billTo, "occupant"))),
  ]);
  return { charges, payments, balance: sum(charges.map((c) => c.charge)) - sum(payments.map((p) => p.payment)) };
}

/** Every company account and every tenant who owes something, for the billing overview. */
export async function billingOverview(today: string) {
  const db = await getDb();
  const contracts = await db
    .select({ contract: schema.contracts, clientName: schema.clients.name })
    .from(schema.contracts)
    .innerJoin(schema.clients, eq(schema.contracts.clientId, schema.clients.id))
    .where(inArray(schema.contracts.status, ["active", "ended", "terminated"]))
    .orderBy(asc(schema.clients.name), asc(schema.contracts.startDate));
  const accounts = await Promise.all(
    contracts.map(async ({ contract, clientName }) => {
      const account = await companyAccount(contract.id, today);
      const next = contract.status === "active" ? await nextStatementMonth(contract) : null;
      const nextPeriod = next ? contractMonthPeriod(contract.startDate, contract.endDate, next) : null;
      return {
        contract,
        clientName,
        balance: account.balance,
        overdue: account.overdue,
        unbilledTotal: account.unbilledTotal,
        depositHeld: account.deposit.held,
        lastStatement: account.statements.at(-1) ?? null,
        // A statement is due once its month has started (or within a week of it).
        statementDue: nextPeriod && nextPeriod.start <= addDaysISO(today, 7) ? { month: next!, start: nextPeriod.start } : null,
      };
    }),
  );
  const tenantRows = await db
    .select({
      occupantId: schema.occupants.id,
      name: schema.occupants.fullName,
      charged: sql<number>`coalesce((select sum(c.amount) from charges c where c.occupant_id = "occupants"."id" and c.bill_to = 'occupant'), 0)::bigint`,
      paid: sql<number>`coalesce((select sum(p.amount) from payments p where p.occupant_id = "occupants"."id" and p.bill_to = 'occupant'), 0)::bigint`,
    })
    .from(schema.occupants)
    .where(sql`exists (select 1 from charges c where c.occupant_id = "occupants"."id" and c.bill_to = 'occupant')`)
    .orderBy(asc(schema.occupants.fullName));
  const tenants = tenantRows
    .map((t) => ({ ...t, balance: Number(t.charged) - Number(t.paid) }))
    .filter((t) => t.balance !== 0);
  return { accounts, tenants };
}

/** Bills for this utility and contract that weren't reversed, newest first. */
export async function liveUtilityBills(utilityTypeId: string, contractId: string) {
  const db = await getDb();
  const bills = await db.select().from(schema.utilityBills)
    .where(and(eq(schema.utilityBills.utilityTypeId, utilityTypeId), eq(schema.utilityBills.contractId, contractId)))
    .orderBy(desc(schema.utilityBills.periodStart));
  const chargeIds = bills.map((b) => b.chargeId).filter((x): x is string => !!x);
  const reversed = chargeIds.length
    ? new Set((await db.select({ id: schema.charges.reversesId }).from(schema.charges).where(inArray(schema.charges.reversesId, chargeIds))).map((r) => r.id))
    : new Set<string | null>();
  return bills.filter((b) => !b.chargeId || !reversed.has(b.chargeId));
}

/** Readings in thousandths of a unit, rates in ten-thousandths of a peso: usage × rate in whole centavos. */
export function meterAmount(previousReading: number, currentReading: number, rate: number): number {
  const usage = BigInt(currentReading - previousReading);
  return Number((usage * BigInt(rate) + BigInt(50_000)) / BigInt(100_000));
}

/** "1234.5" -> 1234500 (thousandths). Up to 3 decimals. */
export function parseReading(input: FormDataEntryValue | null): number | null {
  if (typeof input !== "string") return null;
  const v = input.replace(/[,\s]/g, "");
  if (!/^\d+(\.\d{1,3})?$/.test(v)) return null;
  const [whole, frac = ""] = v.split(".");
  const n = Number(whole) * 1000 + Number(frac.padEnd(3, "0"));
  return Number.isSafeInteger(n) ? n : null;
}

/** "12.5432" pesos per unit -> 125432 (ten-thousandths of a peso). Up to 4 decimals. */
export function parseRate(input: FormDataEntryValue | null): number | null {
  if (typeof input !== "string") return null;
  const v = input.replace(/[₱,\s]/g, "");
  if (!/^\d+(\.\d{1,4})?$/.test(v)) return null;
  const [whole, frac = ""] = v.split(".");
  const n = Number(whole) * 10_000 + Number(frac.padEnd(4, "0"));
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export const formatReading = (thousandths: number | null | undefined) =>
  thousandths == null ? "" : (thousandths / 1000).toLocaleString("en-PH", { maximumFractionDigits: 3 });

export const formatRate = (tenThousandths: number | null | undefined) =>
  tenThousandths == null ? "" : `₱${(tenThousandths / 10_000).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;

export const rateToInput = (tenThousandths: number | null | undefined) =>
  tenThousandths == null ? "" : String(tenThousandths / 10_000);
