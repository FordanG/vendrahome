import { getCurrentStaff } from "@/lib/auth";
import { getPhoto, PHOTO_ROLES } from "@/lib/photos";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Photos are private: only roles that can see the record they belong to may open them.
// Anyone else gets the same answer as a photo that doesn't exist.
export async function GET(_req: Request, ctx: RouteContext<"/api/photos/[id]">) {
  const { id } = await ctx.params;
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  const user = await getCurrentStaff();
  const photo = user && UUID.test(id) ? await getPhoto(id) : undefined;
  if (!user || !photo || (!PHOTO_ROLES[photo.scope].includes(user.role) && photo.uploadedBy !== user.id)) return new Response("Not found", { status: 404, headers });
  return new Response(new Uint8Array(Buffer.from(photo.data, "base64")), { headers: { ...headers, "Content-Type": "image/webp" } });
}
