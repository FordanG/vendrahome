import "server-only";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { StaffRole } from "@/db/schema";

export type PhotoScope = "billing" | "inventory" | "laundry";

/**
 * Who may open a photo: billing papers stay with the office; room-item photos are for everyone who works on rooms;
 * laundry claim photos are for the desk. Whoever uploaded a photo can always open it.
 */
export const PHOTO_ROLES: Record<PhotoScope, StaffRole[]> = {
  billing: ["admin", "front_desk"],
  inventory: ["admin", "front_desk", "maintenance"],
  laundry: ["admin", "front_desk"],
};

const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Re-encodes an uploaded photo (bill, payment proof, room item) and stores it.
 * Returns null when no file was chosen, so photos stay optional.
 */
export async function savePhoto(
  scope: PhotoScope,
  file: FormDataEntryValue | null,
  uploadedBy: string,
): Promise<{ id: string } | { error: string } | null> {
  if (!(file instanceof File) || file.size === 0) return null;
  if (file.size > MAX_BYTES) return { error: "Choose a photo smaller than 8 MB." };
  let data: string;
  try {
    const image = sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 40_000_000 });
    const meta = await image.metadata();
    if (!meta.format || !["jpeg", "png", "webp", "heif"].includes(meta.format) || (meta.pages ?? 1) > 1) {
      return { error: "Choose a still JPG, PNG, WebP or iPhone (HEIC) photo." };
    }
    // Big enough to read a bill or a serial number; rotated upright; no location or camera data kept.
    data = (await image.rotate().resize(1600, 1600, { fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toBuffer()).toString("base64");
  } catch {
    return { error: "This photo could not be read. Try another JPG or PNG." };
  }
  const db = await getDb();
  const [row] = await db.insert(schema.photos).values({ scope, data, uploadedBy }).returning({ id: schema.photos.id });
  return row;
}

export async function getPhoto(id: string) {
  const db = await getDb();
  return db.query.photos.findFirst({ where: eq(schema.photos.id, id) });
}
