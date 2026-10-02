"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN, requireStaff } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { str } from "@/lib/format";
import type { ActionState } from "@/lib/action-state";

function readClient(fd: FormData) {
  return {
    name: str(fd.get("name")),
    tin: str(fd.get("tin")),
    address: str(fd.get("address")),
    contactName: str(fd.get("contactName")),
    contactPhone: str(fd.get("contactPhone")),
    contactEmail: str(fd.get("contactEmail")),
    notes: str(fd.get("notes")),
  };
}

export async function createClient(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireStaff(CAN.manageContracts);
  const values = readClient(fd);
  if (!values.name) return { error: "Company name is required." };
  const db = await getDb();
  const [client] = await db.insert(schema.clients).values({ ...values, name: values.name }).returning();
  await audit(user.id, "create", "client", client.id, { name: client.name });
  revalidatePath("/clients");
  redirect(`/clients/${client.id}`);
}

export async function updateClient(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireStaff(CAN.manageContracts);
  const values = readClient(fd);
  if (!values.name) return { error: "Company name is required." };
  const db = await getDb();
  await db.update(schema.clients).set({ ...values, name: values.name }).where(eq(schema.clients.id, id));
  await audit(user.id, "update", "client", id, values);
  revalidatePath(`/clients/${id}`);
  return { ok: "Saved." };
}
