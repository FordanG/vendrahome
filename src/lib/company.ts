import "server-only";
import { and, asc, eq, gt, inArray, isNull, lte, gte, or } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Client, StayRequest } from "@/db/schema";
import type { Tone } from "@/components/ui";

// Company accounts: everything a company login sees is narrowed to its own company here.

export const AGREEMENT_FIELDS = [
  {
    key: "selfManagePeople",
    label: "The company keeps its people's details",
    hint: "Its logins add and edit their people and give them tenant logins. Off: they can only look.",
  },
  {
    key: "approveRequests",
    label: "The company approves its tenants' requests first",
    hint: "A tenant's request waits for the company's OK before the front desk sees it. Urgent problems still come straight to the hotel.",
  },
  {
    key: "showBilling",
    label: "Company admins see bills",
    hint: "Statements, balance, payments and the deposit.",
  },
] as const satisfies { key: keyof Client; label: string; hint: string }[];

export const STAY_REQUEST_LABELS = { move_in: "Move in", move_out: "Move out" } as const;
export const STAY_REQUEST_STATUS_LABELS: Record<StayRequest["status"], string> = {
  pending: "Waiting for the front desk",
  done: "Done",
  declined: "Declined",
  cancelled: "Cancelled",
};
export const STAY_REQUEST_STATUS_TONES: Record<StayRequest["status"], Tone> = {
  pending: "amber",
  done: "green",
  declined: "gray",
  cancelled: "gray",
};

/** Rooms under the company's active contracts that cover `date`. */
export async function companyRoomIds(clientId: string, date: string) {
  const db = await getDb();
  return db
    .select({ roomId: schema.contractRooms.roomId, contractId: schema.contracts.id })
    .from(schema.contractRooms)
    .innerJoin(schema.contracts, eq(schema.contractRooms.contractId, schema.contracts.id))
    .where(
      and(
        eq(schema.contracts.clientId, clientId),
        eq(schema.contracts.status, "active"),
        lte(schema.contracts.startDate, date),
        gte(schema.contracts.endDate, date),
      ),
    );
}

/** The company's rooms with who lives there now and who is coming. */
export async function companyRooms(clientId: string, today: string) {
  const db = await getDb();
  const covered = await companyRoomIds(clientId, today);
  const ids = [...new Set(covered.map((c) => c.roomId))];
  if (ids.length === 0) return [];
  const [rooms, stays] = await Promise.all([
    db.select().from(schema.rooms).where(inArray(schema.rooms.id, ids)).orderBy(asc(schema.rooms.floor), asc(schema.rooms.number)),
    db
      .select({ a: schema.roomAssignments, name: schema.occupants.fullName, clientId: schema.occupants.clientId })
      .from(schema.roomAssignments)
      .innerJoin(schema.occupants, eq(schema.roomAssignments.occupantId, schema.occupants.id))
      .where(
        and(
          inArray(schema.roomAssignments.roomId, ids),
          or(isNull(schema.roomAssignments.actualCheckOut), gt(schema.roomAssignments.actualCheckOut, today)),
        ),
      )
      .orderBy(asc(schema.roomAssignments.slot), asc(schema.occupants.fullName)),
  ]);
  return rooms.map((room) => {
    const mine = stays.filter((s) => s.a.roomId === room.id);
    // A room is only ever under one company at a time, but never show another company's people.
    const people = mine.filter((s) => s.clientId === clientId);
    return {
      room,
      now: people.filter((s) => s.a.checkIn <= today),
      coming: people.filter((s) => s.a.checkIn > today),
      // Beds already promised to current and future stays.
      free: Math.max(0, room.capacity - mine.length),
    };
  });
}

export type CompanyRoom = Awaited<ReturnType<typeof companyRooms>>[number];

/** The company's own person, or null when it isn't theirs. */
export async function companyOccupant(clientId: string, occupantId: string) {
  const db = await getDb();
  return (
    (await db.query.occupants.findFirst({
      where: and(eq(schema.occupants.id, occupantId), eq(schema.occupants.clientId, clientId)),
    })) ?? null
  );
}

/** Requests a company may see: from its people, or about rooms under its active contracts. */
export async function companyRequestScope(clientId: string) {
  const db = await getDb();
  return or(
    inArray(
      schema.tenantRequests.occupantId,
      db.select({ id: schema.occupants.id }).from(schema.occupants).where(eq(schema.occupants.clientId, clientId)),
    ),
    inArray(
      schema.tenantRequests.roomId,
      db
        .select({ id: schema.contractRooms.roomId })
        .from(schema.contractRooms)
        .innerJoin(schema.contracts, eq(schema.contractRooms.contractId, schema.contracts.id))
        .where(and(eq(schema.contracts.clientId, clientId), eq(schema.contracts.status, "active"))),
    ),
  );
}

/** Whether a new tenant request should wait for the tenant's company first. */
export async function needsCompanyOk(clientId: string | null, urgent: boolean) {
  if (!clientId || urgent) return false;
  const db = await getDb();
  const client = await db.query.clients.findFirst({ where: eq(schema.clients.id, clientId) });
  return !!client?.approveRequests;
}
