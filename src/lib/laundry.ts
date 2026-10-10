import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { LaundryService, LaundryStatus } from "@/db/schema";
import { billToFor, chargeTypeByCode, contractForOccupant } from "./billing";
import { savePhoto } from "./photos";

export const LAUNDRY_STATUS_LABELS: Record<LaundryStatus, string> = {
  at_desk: "At the front desk",
  at_shop: "At the laundry shop",
  ready: "Ready to pick up",
  collected: "Picked up",
  cancelled: "Cancelled",
};

export const LAUNDRY_STATUS_TONES = {
  at_desk: "gray",
  at_shop: "blue",
  ready: "green",
  collected: "gray",
  cancelled: "gray",
} as const;

export const loadLabel = (n: number) => `Load ${n}`;

/** "3.25" or "3,25" kg -> 3250 grams. Up to 50 kg, at most 2 decimals. */
export function parseKilos(input: FormDataEntryValue | null): number | null {
  const raw = String(input ?? "").trim().replace(",", ".");
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(raw)) return null;
  const grams = Math.round(Number(raw) * 1000);
  return grams > 0 && grams <= 50_000 ? grams : null;
}

export const formatKilos = (grams: number | null | undefined) =>
  grams == null ? "" : `${(grams / 1000).toLocaleString("en-PH", { maximumFractionDigits: 2 })} kg`;

/** Kilos × the service's rate, rounded to the centavo, but never below its minimum. */
export function laundryPrice(service: Pick<LaundryService, "ratePerKilo" | "costPerKilo" | "minimumCharge">, grams: number) {
  const amount = Math.max(Math.round((service.ratePerKilo * grams) / 1000), service.minimumCharge ?? 0);
  const cost = service.costPerKilo == null ? null : Math.round((service.costPerKilo * grams) / 1000);
  return { amount, cost };
}

/**
 * Adds the laundry charge for a load to whoever pays under the tenant's contract rule
 * (the tenant by default). Falls back to the tenant when there's no company to bill.
 */
export async function chargeLoad(load: { id: string; number: number; occupantId: string; roomId: string | null }, amount: number, chargedOn: string, staffId: string, description: string) {
  const db = await getDb();
  const type = await chargeTypeByCode("laundry");
  const contractId = await contractForOccupant(load.occupantId, chargedOn);
  const contract = contractId ? await db.query.contracts.findFirst({ where: eq(schema.contracts.id, contractId) }) : null;
  const billable = contract && ["active", "ended", "terminated"].includes(contract.status) ? contract : null;
  let billTo = await billToFor(billable?.id ?? null, type.id);
  if (billTo === "company" && !billable) billTo = "occupant";
  const [charge] = await db
    .insert(schema.charges)
    .values({
      chargeTypeId: type.id,
      billTo,
      contractId: billable?.id ?? null,
      occupantId: load.occupantId,
      roomId: load.roomId,
      description,
      amount,
      chargedOn,
      createdBy: staffId,
    })
    .returning();
  return charge;
}

export const CLAIM_KIND_LABELS = { missing: "Something missing", damaged: "Something damaged" } as const;
export const CLAIM_DAYS = 7;

/** Records a claim on a load that came back. Tenants can claim up to a week after it was ready. */
export async function createClaim(loadId: string, fd: FormData, userId: string, tenantOccupantId?: string) {
  const db = await getDb();
  const load = await db.query.laundryLoads.findFirst({ where: eq(schema.laundryLoads.id, loadId) });
  if (!load || (tenantOccupantId && load.occupantId !== tenantOccupantId)) return { error: "Load not found." } as const;
  if (load.status !== "ready" && load.status !== "collected") return { error: "You can report a problem once the load is back from the shop." } as const;
  if (tenantOccupantId && load.returnedAt && Date.now() - load.returnedAt.getTime() > CLAIM_DAYS * 86_400_000)
    return { error: `Problems need to be reported within ${CLAIM_DAYS} days. Please talk to the front desk.` } as const;
  const kind = String(fd.get("kind"));
  if (kind !== "missing" && kind !== "damaged") return { error: "Is something missing or damaged?" } as const;
  const details = String(fd.get("details") ?? "").trim();
  if (!details) return { error: "Describe what's missing or damaged." } as const;
  if (details.length > 2000) return { error: "Please keep it under 2,000 characters." } as const;
  const photo = await savePhoto("laundry", fd.get("photo"), userId);
  if (photo && "error" in photo) return { error: photo.error } as const;
  const [claim] = await db
    .insert(schema.laundryClaims)
    .values({ loadId, kind, details, photoId: photo?.id ?? null, reportedBy: userId })
    .returning();
  return { claim, load } as const;
}
