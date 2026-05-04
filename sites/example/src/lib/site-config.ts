import pkg from "../../package.json";

interface SiteField {
  hostname: string;
  title?: string;
  description?: string;
}

const site = (pkg as { site?: SiteField }).site;
if (!site?.hostname) {
  throw new Error(`package.json is missing site.hostname`);
}

const title = site.title ?? "Site";
const description = site.description ?? "";

export const siteConfig = {
  hostname: site.hostname,
  url: `https://${site.hostname}`,
  title,
  description,
  locale: "en-US",
  themeColor: "#0b0b0f",
  backgroundColor: "#ffffff",
} as const;
