import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/brand";

// Lets staff and tenants add the app to their phone's home screen.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND.name,
    short_name: BRAND.name,
    start_url: "/",
    display: "standalone",
    background_color: BRAND.paper,
    theme_color: BRAND.ink,
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
