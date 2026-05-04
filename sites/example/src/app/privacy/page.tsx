import type { Metadata } from "next";
import { ConsentSettings } from "../../components/ConsentSettings";
import { siteConfig } from "../../lib/site-config";

export const metadata: Metadata = {
  title: "Privacy",
  description: `Privacy notice and cookie settings for ${siteConfig.title}.`,
  alternates: { canonical: "/privacy/" },
};

export default function PrivacyPage() {
  return (
    <main
      style={{
        fontFamily: "system-ui, -apple-system, sans-serif",
        padding: "2rem",
        maxWidth: 720,
        margin: "0 auto",
        lineHeight: 1.6,
      }}
    >
      <h1>Privacy</h1>

      <h2>Analytics</h2>
      <p>
        {siteConfig.title} uses Google Analytics 4 with Google Consent Mode v2.
        Until you accept analytics cookies, GA runs in cookieless-ping mode:
        pings are sent without an identifier and Google models the aggregate
        session count. No cookies are written.
      </p>
      <p>
        If you accept, GA writes a `_ga` cookie used to measure unique sessions.
        The cookie can be cleared at any time from your browser settings, or by
        clicking <em>Decline analytics cookies</em> below.
      </p>
      <p>
        We honor the{" "}
        <a
          href="https://globalprivacycontrol.org/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Global Privacy Control
        </a>{" "}
        signal. If your browser sends GPC, analytics is treated as denied for
        every visit regardless of any prior choice you made here.
      </p>

      <h2>Cookie settings</h2>
      <ConsentSettings />

      <h2>Contact</h2>
      <p>
        Questions about this notice? Reach out at{" "}
        <a href={`mailto:privacy@${siteConfig.hostname}`}>
          privacy@{siteConfig.hostname}
        </a>
        .
      </p>
    </main>
  );
}
