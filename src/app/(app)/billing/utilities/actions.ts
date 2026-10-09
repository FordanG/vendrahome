"use server";

import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN, requireStaff } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { mutate } from "@/lib/mutations";
import { formatDate, isISODate, parsePeso, str, todayISO } from "@/lib/format";
import { savePhoto } from "@/lib/photos";
import { chargeTypeByCode, formatReading, liveUtilityBills, meterAmount, parseRate, parseReading } from "@/lib/billing";
import type { ActionState } from "@/lib/action-state";

export async function saveUtilityType(id: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageBilling);
    const db = await getDb();
    const name = str(fd.get("name"));
    if (!name) return { error: "Name the utility, e.g. Internet." };
    const rateInput = str(fd.get("rate"));
    const rate = rateInput ? parseRate(rateInput) : null;
    if (rateInput && rate === null) return { error: "The rate must be a peso amount per unit with up to 4 decimals, e.g. 12.5432." };
    const values = {
      name,
      provider: str(fd.get("provider")),
      unit: str(fd.get("unit")),
      defaultMethod: fd.get("defaultMethod") === "meter" ? ("meter" as const) : ("bill" as const),
      rate,
      active: id ? fd.get("active") === "on" : true,
    };
    if (values.defaultMethod === "meter" && (!values.unit || !values.rate)) return { error: "For meter readings, enter the unit (e.g. kWh) and the rate per unit." };
    const clash = await db.query.utilityTypes.findFirst({ where: eq(schema.utilityTypes.name, name) });
    if (clash && clash.id !== id) return { error: "There's already a utility with that name." };
    if (id) {
      const before = await db.query.utilityTypes.findFirst({ where: eq(schema.utilityTypes.id, id) });
      if (!before) return { error: "Utility not found." };
      await db.update(schema.utilityTypes).set(values).where(eq(schema.utilityTypes.id, id));
      await audit(user.id, "update", "utility_type", id, { before, after: values });
      return { ok: "Saved." };
    }
    const [row] = await db.insert(schema.utilityTypes).values({ ...values, position: 100 }).returning();
    await audit(user.id, "create", "utility_type", row.id, { ...row });
    return { ok: "Utility added." };
  });
}

/**
 * Records one utility bill for a contract and charges it to the company.
 * Amount comes from the provider's bill, or from main-meter readings × the rate.
 */
export async function addUtilityBill(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireStaff(CAN.manageBilling);
    const db = await getDb();
    const type = await db.query.utilityTypes.findFirst({ where: eq(schema.utilityTypes.id, String(fd.get("utilityTypeId"))) });
    const contract = await db.query.contracts.findFirst({ where: eq(schema.contracts.id, String(fd.get("contractId"))) });
    if (!type || !type.active) return { error: "Pick the utility." };
    if (!contract || contract.status === "draft") return { error: "Pick an active or ended contract." };
    const periodStart = str(fd.get("periodStart"));
    const periodEnd = str(fd.get("periodEnd"));
    const dueDate = str(fd.get("dueDate"));
    if (!isISODate(periodStart) || !isISODate(periodEnd)) return { error: "Enter the billing period's first and last day." };
    if (periodEnd < periodStart) return { error: "The period's last day must be after its first day." };
    if (periodEnd > todayISO()) return { error: "Enter a bill once its period has ended." };
    if (dueDate && !isISODate(dueDate)) return { error: "The due date isn't a valid date." };

    const earlier = await liveUtilityBills(type.id, contract.id);
    const overlap = earlier.find((b) => b.periodStart <= periodEnd && b.periodEnd >= periodStart);
    if (overlap) return { error: `There's already a ${type.name.toLowerCase()} bill for ${formatDate(overlap.periodStart)} – ${formatDate(overlap.periodEnd)}. Reverse it first if it was wrong.` };

    const method = fd.get("method") === "meter" ? "meter" : "bill";
    let amount: number | null;
    let previousReading: number | null = null;
    let currentReading: number | null = null;
    let rate: number | null = null;
    if (method === "meter") {
      previousReading = parseReading(fd.get("previousReading"));
      currentReading = parseReading(fd.get("currentReading"));
      rate = parseRate(fd.get("rate")) ?? type.rate;
      if (previousReading === null || currentReading === null) return { error: "Enter both meter readings, e.g. 12345.6." };
      if (currentReading < previousReading) return { error: "This reading is lower than the last one. Check the meter photo and the numbers." };
      if (!rate) return { error: "Enter the rate per unit." };
      amount = meterAmount(previousReading, currentReading, rate);
    } else {
      amount = parsePeso(fd.get("amount"));
      if (!amount) return { error: "Enter the amount on the provider's bill." };
    }
    if (!amount) return { error: "This works out to ₱0. Check the readings." };

    const photo = await savePhoto("billing", fd.get("photo"), user.id);
    if (photo && "error" in photo) return photo;
    const utilityType = await chargeTypeByCode("utility");
    const usage = method === "meter" ? ` (${formatReading(currentReading! - previousReading!)} ${type.unit ?? "units"})` : "";
    const [charge] = await db.insert(schema.charges).values({
      chargeTypeId: utilityType.id,
      billTo: "company",
      contractId: contract.id,
      description: `${type.name}, ${formatDate(periodStart)} – ${formatDate(periodEnd)}${usage}`,
      amount,
      chargedOn: periodEnd,
      createdBy: user.id,
    }).returning();
    const [bill] = await db.insert(schema.utilityBills).values({
      utilityTypeId: type.id,
      contractId: contract.id,
      periodStart,
      periodEnd,
      dueDate,
      method,
      previousReading,
      currentReading,
      rate,
      amount,
      photoId: photo?.id ?? null,
      notes: str(fd.get("notes")),
      chargeId: charge.id,
      createdBy: user.id,
    }).returning();
    await audit(user.id, "create", "utility_bill", bill.id, { ...bill });
    return { ok: `${type.name} bill saved. It goes on the company's next statement.` };
  });
}
