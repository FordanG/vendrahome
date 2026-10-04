import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireUser } from "@/lib/auth";

export async function GET() {
  const user = await requireUser();
  const db = await getDb();
  const photo = await db.query.accountPhotos.findFirst({ where: eq(schema.accountPhotos.staffId, user.id) });
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  if (!photo) return new Response(null, { status: 404, headers });
  return new Response(new Uint8Array(Buffer.from(photo.data, "base64")), {
    headers: { ...headers, "Content-Type": "image/webp" },
  });
}
