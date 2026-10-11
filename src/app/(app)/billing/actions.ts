"use server";

import { and, eq, isNull, lte } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { PaymentMethod } from "@/db/schema";
import { CAN, requireStaff } from "@/lib/auth";
import { contractInReach, occupantInReach, roomInReach } from "@/lib/hotel";
import type { Staff } from "@/db/schema";
import { audit } from "@/lib/audit";
import { mutate } from "@/lib/mutations";
import { addDaysISO, isISODate, parsePeso, str, todayISO } from "@/lib/format";
import { savePhoto } from "@/lib/photos";
import {
  billToFor,
  chargeTypeByCode,
  companyAccount,
  contractForOccupant,
  PAYMENT_METHOD_LABELS,
  statementDraft,
} from "@/lib/billing";
import type { ActionState } from "@/lib/action-state";

const BILLABLE = ["active", "ended", "terminated"] as const;

async function billableContract(user: Staff, id: string | null) {
  const contract = await contractInReach(user, id);
  return contract && (BILLABLE as readonly string[]).includes(contract.status) ? contract : null;
}

/** A charge, payment or deposit entry belongs to a contract or a tenant this login can reach. */
async function accountInReach(user: Staff, row: { contractId: string | null; occupantId?: string | null }) {
  if (row.contractId) return !!(await contractInReach(user, row.contractId));
  return !!(await occupantInReach(user, row.occupantId ?? null));
}

/** Adds a charge. Who pays follows the contract's charge rule unless staff pick otherwise. */
export async function addCharge(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.recordBilling);
    const db = await getDb();
    const chargeTypeId = str(fd.get("chargeTypeId"));
    const description = str(fd.get("description"));
    const chargedOn = str(fd.get("chargedOn")) ?? todayISO();
    const amount = parsePeso(fd.get("amount"));
    const credit = fd.get("credit") === "on";
    let occupantId = str(fd.get("occupantId"));
    let contractId = str(fd.get("contractId"));
    const type = chargeTypeId ? await db.query.chargeTypes.findFirst({ where: eq(schema.chargeTypes.id, chargeTypeId) }) : null;
    if (!type || !type.active) return { error: "Pick what the charge is for." };
    if (type.code === "rent") return { error: "Rent is added by issuing the monthly statement, not by hand." };
    if (type.code === "utility") return { error: "Utilities are added from Billing → Utilities, from the provider's bill or the meter." };
    if (!description) return { error: "Describe the charge, e.g. \"Replacement key card\"." };
    if (!amount) return { error: "Enter an amount greater than ₱0." };
    if (!isISODate(chargedOn) || chargedOn > todayISO()) return { error: "The date must be today or earlier." };
    if (credit && !CAN.manageBilling.includes(user.role)) return { error: "Only the admin can give a credit." };

    if (occupantId) {
      const occupant = await occupantInReach(user, occupantId);
      if (!occupant) return { error: "Tenant not found." };
      contractId ??= await contractForOccupant(occupantId, chargedOn);
    }
    const contract = await billableContract(user, contractId);
    if (contractId && !contract) return { error: "That contract can't be billed. Only active or ended contracts have an account." };

    const choice = fd.get("billTo");
    const billTo = choice === "company" || choice === "occupant" ? choice : await billToFor(contract?.id ?? null, type.id);
    if (billTo === "company" && !contract) return { error: "This tenant has no contract to bill the company under. Bill the tenant instead." };
    if (billTo === "occupant" && !occupantId) return { error: "Pick the tenant to bill, or bill the company." };
    if (billTo === "company" && !occupantId) occupantId = null;

    let roomId = str(fd.get("roomId"));
    if (roomId && !(await roomInReach(user, roomId))) return { error: "Room not found." };
    if (!roomId && occupantId) {
      const stay = await db.query.roomAssignments.findFirst({
        where: and(eq(schema.roomAssignments.occupantId, occupantId), lte(schema.roomAssignments.checkIn, chargedOn)),
        orderBy: (a, { desc }) => [desc(a.checkIn)],
      });
      roomId = stay?.roomId ?? null;
    }
    const [charge] = await db.insert(schema.charges).values({
      chargeTypeId: type.id,
      billTo,
      contractId: contract?.id ?? null,
      occupantId,
      roomId,
      description: credit ? `Credit: ${description}` : description,
      amount: credit ? -amount : amount,
      chargedOn,
      createdBy: user.id,
    }).returning();
    await audit(user.id, credit ? "credit" : "charge", "charge", charge.id, { ...charge });
    return { ok: billTo === "company" ? "Charge added. It goes on the company's next statement." : "Charge added to the tenant's account." };
  });
}

/** Undoes a charge with an equal and opposite one. The original stays in the record. */
export async function reverseCharge(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageBilling);
    const reason = str(fd.get("reason"));
    if (!reason) return { error: "Say why it's being reversed, e.g. \"Entered twice\"." };
    const db = await getDb();
    const original = await db.query.charges.findFirst({ where: eq(schema.charges.id, id) });
    if (!original || !(await accountInReach(user, original))) return { error: "Charge not found." };
    if (original.reversesId) return { error: "This is already a correction. Add a new charge instead." };
    const already = await db.query.charges.findFirst({ where: eq(schema.charges.reversesId, id) });
    if (already) return { error: "This charge was already reversed." };
    const [reversal] = await db.insert(schema.charges).values({
      chargeTypeId: original.chargeTypeId,
      billTo: original.billTo,
      contractId: original.contractId,
      occupantId: original.occupantId,
      roomId: original.roomId,
      description: `Reversal of "${original.description}": ${reason}`,
      amount: -original.amount,
      chargedOn: todayISO(),
      reversesId: original.id,
      createdBy: user.id,
    }).returning();
    await audit(user.id, "reverse", "charge", original.id, { reason, reversalId: reversal.id, amount: original.amount });
    return { ok: original.statementId ? "Reversed. The correction goes on the next statement." : "Reversed." };
  });
}

/** Moves a charge between the company and the tenant, only while it isn't on a statement yet. */
export async function switchPayer(id: string): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.recordBilling);
    const db = await getDb();
    const charge = await db.query.charges.findFirst({ where: eq(schema.charges.id, id) });
    if (!charge || !(await accountInReach(user, charge))) return { error: "Charge not found." };
    if (charge.statementId) return { error: "This charge is already on a statement. Reverse it and add it again instead." };
    if (charge.reversesId || (await db.query.charges.findFirst({ where: eq(schema.charges.reversesId, id) })))
      return { error: "Reversed charges can't be moved." };
    const type = await db.query.chargeTypes.findFirst({ where: eq(schema.chargeTypes.id, charge.chargeTypeId) });
    if (type?.code === "rent" || type?.code === "utility") return { error: "Rent and utilities are always billed to the company." };
    const to = charge.billTo === "company" ? "occupant" : "company";
    if (to === "occupant" && !charge.occupantId) return { error: "This charge isn't for a particular tenant, so it stays with the company." };
    if (to === "company" && !(await billableContract(user, charge.contractId))) return { error: "This tenant has no contract to bill the company under." };
    await db.update(schema.charges).set({ billTo: to }).where(eq(schema.charges.id, id));
    await audit(user.id, "switch_payer", "charge", id, { from: charge.billTo, to });
    return { ok: to === "company" ? "Moved to the company's account." : "Moved to the tenant's account." };
  });
}

const METHODS = Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[];

export async function recordPayment(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.recordBilling);
    const db = await getDb();
    const billTo = fd.get("billTo") === "occupant" ? "occupant" : "company";
    const contractId = str(fd.get("contractId"));
    const occupantId = str(fd.get("occupantId"));
    const amount = parsePeso(fd.get("amount"));
    const method = String(fd.get("method")) as PaymentMethod;
    const receivedOn = str(fd.get("receivedOn")) ?? todayISO();
    if (!amount) return { error: "Enter the amount received." };
    if (!METHODS.includes(method)) return { error: "Pick how it was paid." };
    if (!isISODate(receivedOn) || receivedOn > todayISO()) return { error: "The date received must be today or earlier." };
    const reference = str(fd.get("reference"));
    if (["bank_transfer", "gcash", "maya", "check"].includes(method) && !reference)
      return { error: "Enter the reference or check number so the payment can be traced." };
    if (billTo === "company") {
      if (!(await billableContract(user, contractId))) return { error: "Pick an active or ended contract." };
    } else if (!occupantId || !(await occupantInReach(user, occupantId))) {
      return { error: "Tenant not found." };
    }
    const photo = await savePhoto("billing", fd.get("proof"), user.id);
    if (photo && "error" in photo) return photo;
    const [payment] = await db.insert(schema.payments).values({
      billTo,
      contractId: billTo === "company" ? contractId : null,
      occupantId: billTo === "occupant" ? occupantId : null,
      amount,
      method,
      reference,
      receivedOn,
      officialReceiptNo: str(fd.get("officialReceiptNo")),
      proofPhotoId: photo?.id ?? null,
      notes: str(fd.get("notes")),
      createdBy: user.id,
    }).returning();
    await audit(user.id, "payment", "payment", payment.id, { ...payment });
    return { ok: "Payment recorded." };
  });
}

/** For a bounced check or a payment entered by mistake. */
export async function reversePayment(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageBilling);
    const reason = str(fd.get("reason"));
    if (!reason) return { error: "Say why, e.g. \"Check bounced\"." };
    const db = await getDb();
    const original = await db.query.payments.findFirst({ where: eq(schema.payments.id, id) });
    if (!original || !(await accountInReach(user, original))) return { error: "Payment not found." };
    if (original.reversesId) return { error: "This is already a correction." };
    if (await db.query.payments.findFirst({ where: eq(schema.payments.reversesId, id) })) return { error: "This payment was already reversed." };
    const [reversal] = await db.insert(schema.payments).values({
      billTo: original.billTo,
      contractId: original.contractId,
      occupantId: original.occupantId,
      amount: -original.amount,
      method: original.method,
      reference: original.reference,
      receivedOn: todayISO(),
      notes: `Reversal: ${reason}`,
      reversesId: original.id,
      createdBy: user.id,
    }).returning();
    await audit(user.id, "reverse", "payment", id, { reason, reversalId: reversal.id, amount: original.amount });
    return { ok: "Payment reversed. The amount is owed again." };
  });
}

/**
 * Freezes the next month's statement: adds that month's rent, and takes in every
 * company charge and payment not on a statement yet, up to the issue date.
 */
export async function issueStatement(contractId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageBilling);
    const db = await getDb();
    const contract = await billableContract(user, contractId);
    if (!contract) return { error: "Only active or ended contracts get statements." };
    const issuedOn = str(fd.get("issuedOn")) ?? todayISO();
    const dueDate = str(fd.get("dueDate")) ?? addDaysISO(issuedOn, 7);
    if (!isISODate(issuedOn) || issuedOn > todayISO()) return { error: "The issue date must be today or earlier." };
    if (!isISODate(dueDate) || dueDate < issuedOn) return { error: "The due date must be on or after the issue date." };
    const draft = await statementDraft(contract, issuedOn);
    if (!draft) return { error: "Every month of this contract already has a statement." };
    if (String(draft.month) !== String(fd.get("month"))) return { error: "Someone issued a statement meanwhile. Reload the page and check it again." };
    if (draft.period.start > addDaysISO(issuedOn, 31)) return { error: "This month starts more than a month after the issue date. Issue it closer to the time." };
    if (draft.missingRates > 0) return { error: "Some rooms in this contract have no rate yet. Set every room's rate first." };
    if (draft.rent <= 0) return { error: "This contract's rent is ₱0. Check its terms first." };

    const sameNumber = await db.query.statements.findFirst({ where: eq(schema.statements.number, `${contract.reference}-${String(draft.month).padStart(2, "0")}`) });
    const number = `${contract.reference}-${String(draft.month).padStart(2, "0")}${sameNumber ? `-${contract.id.slice(0, 4).toUpperCase()}` : ""}`;
    const [statement] = await db.insert(schema.statements).values({
      contractId,
      number,
      rentMonth: draft.month,
      periodStart: draft.period.start,
      periodEnd: draft.period.end,
      issuedOn,
      dueDate,
      previousBalance: draft.previousBalance,
      newCharges: draft.newCharges,
      paymentsReceived: draft.paymentsReceived,
      balanceDue: draft.balanceDue,
      notes: str(fd.get("notes")),
      createdBy: user.id,
    }).returning();
    const rentType = await chargeTypeByCode("rent");
    await db.insert(schema.charges).values({
      chargeTypeId: rentType.id,
      billTo: "company",
      contractId,
      description: draft.rentDescription,
      amount: draft.rent,
      chargedOn: draft.period.start,
      rentMonth: draft.month,
      statementId: statement.id,
      createdBy: user.id,
    });
    const chargeIds = draft.charges.map((c) => c.charge.id);
    const paymentIds = draft.payments.map((p) => p.payment.id);
    for (const id of chargeIds) await db.update(schema.charges).set({ statementId: statement.id }).where(and(eq(schema.charges.id, id), isNull(schema.charges.statementId)));
    for (const id of paymentIds) await db.update(schema.payments).set({ statementId: statement.id }).where(and(eq(schema.payments.id, id), isNull(schema.payments.statementId)));
    await audit(user.id, "issue", "statement", statement.id, { ...statement, charges: chargeIds.length, payments: paymentIds.length });
    return { redirectTo: `/billing/statements/${statement.id}` };
  });
}

export async function addDepositEntry(contractId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageBilling);
    const db = await getDb();
    const contract = await billableContract(user, contractId);
    if (!contract) return { error: "Only active or ended contracts hold a deposit." };
    const kind = fd.get("kind");
    if (kind !== "received" && kind !== "deduction" && kind !== "refund") return { error: "Pick what happened to the deposit." };
    const amount = parsePeso(fd.get("amount"));
    const entryOn = str(fd.get("entryOn")) ?? todayISO();
    const description = str(fd.get("description"));
    if (!amount) return { error: "Enter an amount greater than ₱0." };
    if (!isISODate(entryOn) || entryOn > todayISO()) return { error: "The date must be today or earlier." };
    if (!description) return { error: kind === "deduction" ? "Say what the deduction is for." : "Add a short note, e.g. the reference number." };
    if (kind !== "received") {
      const { deposit } = await companyAccount(contractId, todayISO());
      if (amount > deposit.held) return { error: `Only ${new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(deposit.held / 100)} of the deposit is left.` };
    }
    const [entry] = await db.insert(schema.depositEntries).values({ contractId, kind, amount, entryOn, description, createdBy: user.id }).returning();
    await audit(user.id, `deposit_${kind}`, "deposit", entry.id, { ...entry });
    return { ok: "Saved." };
  });
}

export async function reverseDepositEntry(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageBilling);
    const reason = str(fd.get("reason"));
    if (!reason) return { error: "Say why it's being reversed." };
    const db = await getDb();
    const original = await db.query.depositEntries.findFirst({ where: eq(schema.depositEntries.id, id) });
    if (!original || !(await contractInReach(user, original.contractId))) return { error: "Entry not found." };
    if (original.reversesId) return { error: "This is already a correction." };
    if (await db.query.depositEntries.findFirst({ where: eq(schema.depositEntries.reversesId, id) })) return { error: "Already reversed." };
    if (original.kind === "received") {
      const { deposit } = await companyAccount(original.contractId, todayISO());
      if (deposit.held - original.amount < 0) return { error: "Reverse the deductions or refunds made from this money first." };
    }
    const [entry] = await db.insert(schema.depositEntries).values({
      contractId: original.contractId,
      kind: original.kind,
      amount: -original.amount,
      entryOn: todayISO(),
      description: `Reversal of "${original.description}": ${reason}`,
      reversesId: original.id,
      createdBy: user.id,
    }).returning();
    // A deduction for a damaged item can be made again once reversed.
    if (original.kind === "deduction") await db.update(schema.inventoryCheckLines).set({ depositEntryId: null }).where(eq(schema.inventoryCheckLines.depositEntryId, id));
    await audit(user.id, "reverse", "deposit", id, { reason, reversalId: entry.id });
    return { ok: "Reversed." };
  });
}

/** Who pays a kind of charge under one contract. "default" removes the contract's own rule. */
export async function setChargeRule(contractId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageBilling);
    const db = await getDb();
    const chargeTypeId = str(fd.get("chargeTypeId"));
    const choice = fd.get("billTo");
    const type = chargeTypeId ? await db.query.chargeTypes.findFirst({ where: eq(schema.chargeTypes.id, chargeTypeId) }) : null;
    if (!type) return { error: "Charge type not found." };
    if (type.code === "rent" || type.code === "utility") return { error: "Rent and utilities are always billed to the company." };
    if (!(await contractInReach(user, contractId))) return { error: "Contract not found." };
    const where = and(eq(schema.contractChargeRules.contractId, contractId), eq(schema.contractChargeRules.chargeTypeId, type.id));
    if (choice === "company" || choice === "occupant") {
      await db.insert(schema.contractChargeRules).values({ contractId, chargeTypeId: type.id, billTo: choice })
        .onConflictDoUpdate({ target: [schema.contractChargeRules.contractId, schema.contractChargeRules.chargeTypeId], set: { billTo: choice } });
    } else {
      await db.delete(schema.contractChargeRules).where(where);
    }
    await audit(user.id, "charge_rule", "contract", contractId, { chargeType: type.name, billTo: choice });
    return { ok: "Saved." };
  });
}

export async function saveChargeType(id: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageBilling);
    const db = await getDb();
    const name = str(fd.get("name"));
    const defaultBillTo = fd.get("defaultBillTo") === "occupant" ? "occupant" : "company";
    if (!name) return { error: "Name the charge type." };
    const clash = await db.query.chargeTypes.findFirst({ where: eq(schema.chargeTypes.name, name) });
    if (clash && clash.id !== id) return { error: "There's already a charge type with that name." };
    if (id) {
      const current = await db.query.chargeTypes.findFirst({ where: eq(schema.chargeTypes.id, id) });
      if (!current) return { error: "Charge type not found." };
      const fixed = current.code === "rent" || current.code === "utility";
      const active = fixed ? true : fd.get("active") === "on";
      await db.update(schema.chargeTypes).set({ name, defaultBillTo: fixed ? "company" : defaultBillTo, active }).where(eq(schema.chargeTypes.id, id));
      await audit(user.id, "update", "charge_type", id, { before: current, after: { name, defaultBillTo, active } });
      return { ok: "Saved." };
    }
    const [row] = await db.insert(schema.chargeTypes).values({ name, defaultBillTo, position: 100 }).returning();
    await audit(user.id, "create", "charge_type", row.id, { ...row });
    return { ok: "Charge type added." };
  });
}
