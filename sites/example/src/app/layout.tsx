import type { Metadata, Viewport } from "next";
import { Analytics } from "../components/Analytics";
import { ConsentBanner } from "../components/ConsentBanner";
import { JsonLd } from "../components/JsonLd";
import { siteConfig } from "../lib/site-config";
import { Providers } from "./providers";

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: siteConfig.title,
    template: `%s — ${siteConfig.title}`,
  },
  description: siteConfig.description,
  applicationName: siteConfig.title,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: siteConfig.title,
    title: siteConfig.title,
    description: siteConfig.description,
    url: siteConfig.url,
    locale: siteConfig.locale.replace("-", "_"),
  },
  twitter: {
    card: "summary_large_image",
    title: siteConfig.title,
    description: siteConfig.description,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = {
  themeColor: siteConfig.themeColor,
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang={siteConfig.locale}>
      <body>
        <Analytics />
        <JsonLd />
        <Providers>
          {children}
          <ConsentBanner />
        </Providers>
      </body>
    </html>
  );
}
