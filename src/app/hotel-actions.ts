"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { HOTEL_COOKIE, requireHotel } from "@/lib/hotel";

/** Switches the hotel the owner is looking at, on this device. */
export async function switchHotel(formData: FormData) {
  const { hotels } = await requireHotel();
  const id = formData.get("hotel");
  if (!hotels.some((h) => h.id === id)) return;
  (await cookies()).set(HOTEL_COOKIE, String(id), { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  revalidatePath("/", "layout");
  redirect("/");
}
