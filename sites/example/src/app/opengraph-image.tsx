import { ImageResponse } from "next/og";
import { siteConfig } from "../lib/site-config";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = siteConfig.title;
export const dynamic = "force-static";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        background: siteConfig.themeColor,
        color: "#ffffff",
        padding: "80px",
        fontFamily: "system-ui",
      }}
    >
      <div
        style={{
          fontSize: 96,
          fontWeight: 700,
          textAlign: "center",
          lineHeight: 1.05,
          letterSpacing: -2,
        }}
      >
        {siteConfig.title}
      </div>
      {siteConfig.description ? (
        <div
          style={{
            fontSize: 36,
            marginTop: 32,
            opacity: 0.7,
            textAlign: "center",
            maxWidth: 1000,
            lineHeight: 1.3,
          }}
        >
          {siteConfig.description}
        </div>
      ) : null}
      <div
        style={{
          position: "absolute",
          bottom: 56,
          fontSize: 22,
          opacity: 0.5,
          letterSpacing: 1,
        }}
      >
        {siteConfig.hostname}
      </div>
    </div>,
    size,
  );
}
