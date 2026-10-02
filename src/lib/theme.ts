import "server-only";
import { cookies } from "next/headers";

// Light or dark is a choice kept on each device (a cookie), not on the account:
// the front desk computer and someone's own phone can differ.
export const THEME_COOKIE = "theme";
export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_LABELS: Record<Theme, string> = {
  light: "Light",
  dark: "Dark",
  system: "Same as device",
};

export const isTheme = (v: unknown): v is Theme => THEMES.includes(v as Theme);

/** "system" (follow the device's own setting) until the person picks one. */
export async function getTheme(): Promise<Theme> {
  const value = (await cookies()).get(THEME_COOKIE)?.value;
  return isTheme(value) ? value : "system";
}
