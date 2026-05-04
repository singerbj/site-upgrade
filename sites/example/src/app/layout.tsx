import type { Metadata } from "next";
import { Analytics } from "../components/Analytics";
import { ConsentBanner } from "../components/ConsentBanner";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Example Site",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
      </head>
      <body>
        <Analytics />
        <Providers>
          {children}
          <ConsentBanner />
        </Providers>
      </body>
    </html>
  );
}
