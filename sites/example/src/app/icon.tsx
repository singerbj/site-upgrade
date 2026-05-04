import { ImageResponse } from "next/og";
import { siteConfig } from "../lib/site-config";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";
export const dynamic = "force-static";

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: siteConfig.themeColor,
        color: "#ffffff",
        fontSize: 22,
        fontWeight: 700,
        fontFamily: "system-ui",
        letterSpacing: -1,
      }}
    >
      {siteConfig.title.charAt(0).toUpperCase()}
    </div>,
    size,
  );
}
