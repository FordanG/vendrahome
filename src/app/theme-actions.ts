"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { isTheme, THEME_COOKIE } from "@/lib/theme";

/** Remembers light, dark or "same as device" on this device for a year. */
export async function setTheme(formData: FormData) {
  const theme = formData.get("theme");
  if (!isTheme(theme)) return;
  (await cookies()).set(THEME_COOKIE, theme, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  revalidatePath("/", "layout");
}
