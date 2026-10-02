import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import { BRAND } from "@/lib/brand";
import { getTheme } from "@/lib/theme";
import "./globals.css";

// Vendrato's two families: Inter for reading, Space Grotesk for the logo, headings and room numbers.
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const spaceGrotesk = Space_Grotesk({ variable: "--font-space-grotesk", subsets: ["latin"] });

export const metadata: Metadata = {
  title: BRAND.name,
  description: BRAND.description,
  appleWebApp: { title: BRAND.name, statusBarStyle: "black-translucent" },
};

// Phones: the browser bar takes the header's black, and the page can reach under
// the notch and home bar (the tab bars pad themselves with the safe-area insets).
export const viewport: Viewport = {
  themeColor: BRAND.ink,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // A picked look goes on <html>; left on "Same as device", the CSS follows the device instead.
  const theme = await getTheme();
  return (
    <html lang="en" data-theme={theme === "system" ? undefined : theme} className={`${inter.variable} ${spaceGrotesk.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
