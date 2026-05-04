import type { MetadataRoute } from "next";
import { siteConfig } from "../lib/site-config";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: siteConfig.title,
    short_name: siteConfig.title,
    description: siteConfig.description,
    start_url: "/",
    display: "standalone",
    theme_color: siteConfig.themeColor,
    background_color: siteConfig.backgroundColor,
    icons: [
      { src: "/icon", sizes: "32x32", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
