import { ImageResponse } from "next/og";
import { siteConfig } from "../lib/site-config";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";
export const dynamic = "force-static";

export default function AppleIcon() {
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
        fontSize: 120,
        fontWeight: 700,
        fontFamily: "system-ui",
        letterSpacing: -4,
        borderRadius: 36,
      }}
    >
      {siteConfig.title.charAt(0).toUpperCase()}
    </div>,
    size,
  );
}
