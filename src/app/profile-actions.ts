"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { getDb, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { mutate } from "@/lib/mutations";
import type { ActionState } from "@/lib/action-state";

const profile = z.object({
  name: z.string().trim().min(1, "Enter your display name.").max(100, "Keep your display name under 101 characters."),
  email: z.union([z.literal(""), z.email("Enter a valid email address.").max(254)]),
  phone: z.string().max(30, "Keep your mobile number under 31 characters.")
    .refine(value => !value || (/^[+\d\s().-]+$/.test(value) && value.replace(/\D/g, "").length >= 7), "Enter a valid mobile number, including the country code if needed."),
});

export async function uploadOwnPhoto(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const file = fd.get("photo");
  if (!(file instanceof File) || !file.size) return { error: "Choose a photo first." };
  if (file.size > 2 * 1024 * 1024) return { error: "Choose a photo smaller than 2 MB." };
  let data: string;
  try {
    const image = sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 20_000_000 });
    const metadata = await image.metadata();
    if (!metadata.format || !["jpeg", "png", "webp"].includes(metadata.format) || (metadata.pages ?? 1) > 1) {
      return { error: "Choose a still JPG, PNG, or WebP photo." };
    }
    data = (await image.rotate().resize(512, 512, { fit: "cover" }).webp({ quality: 80 }).toBuffer()).toString("base64");
  } catch {
    return { error: "This photo could not be read. Try another JPG, PNG, or WebP image under 20 megapixels." };
  }
  return mutate(async () => {
    const db = await getDb();
    const account = await db.query.staff.findFirst({ where: eq(schema.staff.id, user.id) });
    if (!account?.active) return { error: "Your account is no longer active. Please sign in again." };
    const version = randomUUID();
    await db.insert(schema.accountPhotos).values({ staffId: user.id, data, version })
      .onConflictDoUpdate({ target: schema.accountPhotos.staffId, set: { data, version } });
    await audit(user.id, "update_profile_photo", "staff", user.id, { version });
    return { ok: "Profile photo saved." };
  });
}

export async function removeOwnPhoto(): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireUser();
    const db = await getDb();
    const account = await db.query.staff.findFirst({ where: eq(schema.staff.id, user.id) });
    if (!account?.active) return { error: "Your account is no longer active. Please sign in again." };
    await db.delete(schema.accountPhotos).where(eq(schema.accountPhotos.staffId, user.id));
    await audit(user.id, "remove_profile_photo", "staff", user.id);
    return { ok: "Profile photo removed." };
  });
}

/** The session determines the target account; submitted IDs and roles are ignored. */
export async function updateOwnProfile(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(async () => {
    const user = await requireUser();
    const parsed = profile.safeParse({
      name: String(fd.get("name") ?? ""),
      email: String(fd.get("email") ?? "").trim(),
      phone: String(fd.get("phone") ?? "").trim(),
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const values = { name: parsed.data.name, email: parsed.data.email || null, phone: parsed.data.phone || null };
    const db = await getDb();
    const before = await db.query.staff.findFirst({ where: eq(schema.staff.id, user.id) });
    if (!before?.active) return { error: "Your account is no longer active. Please sign in again." };
    await db.update(schema.staff).set(values).where(eq(schema.staff.id, user.id));
    await audit(user.id, "update_profile", "staff", user.id, {
      before: { name: before.name, email: before.email, phone: before.phone }, after: values,
    });
    return { ok: "Profile saved." };
  });
}
