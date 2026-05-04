import { writeFileSync } from "node:fs";
import type { Page } from "playwright";

// Structured snapshot of every signal that drives both classical SEO
// and Answer Engine Optimization. The AI assessor reads this instead
// of trying to extract structure from a screenshot. The same shape is
// captured for both the existing site and the generated site so before
// vs after comparisons are apples-to-apples.

export interface SeoSnapshot {
  url: string;
  title: string;
  description: string;
  keywords: string;
  canonical: string;
  lang: string;
  viewport: string;
  robots: string;
  og: {
    title: string;
    description: string;
    image: string;
    type: string;
    url: string;
    site_name: string;
  };
  twitter: {
    card: string;
    title: string;
    description: string;
  };
  h1s: string[];
  h2s: string[];
  jsonLdTypes: string[];
  jsonLdRaw: string[];
  imageCount: number;
  imagesWithAlt: number;
  internalLinks: number;
  externalLinks: number;
  hasFaq: boolean;
  hasContactInfo: boolean;
  scriptCount: number;
  textLength: number;
  https: boolean;
  // Computed font-family stacks pulled from the rendered DOM. Used by
  // the brand kit; not strictly an SEO signal but cheap to capture in
  // the same evaluate pass.
  fonts: { heading: string; body: string };
}

export async function extractSeoSnapshot(page: Page): Promise<SeoSnapshot> {
  const url = page.url();
  const data = await page.evaluate(() => {
    const meta = (sel: string, attr = "content"): string =>
      document.querySelector(sel)?.getAttribute(attr) ?? "";

    const ldTypes: string[] = [];
    const ldRaw: string[] = [];
    document
      .querySelectorAll('script[type="application/ld+json"]')
      .forEach((s) => {
        const text = s.textContent ?? "";
        ldRaw.push(text.slice(0, 4000));
        try {
          const parsed = JSON.parse(text);
          const collect = (n: unknown): void => {
            if (!n || typeof n !== "object") return;
            const obj = n as Record<string, unknown>;
            if (typeof obj["@type"] === "string") ldTypes.push(obj["@type"]);
            if (Array.isArray(obj["@type"])) {
              for (const t of obj["@type"]) {
                if (typeof t === "string") ldTypes.push(t);
              }
            }
            if (Array.isArray(obj["@graph"])) {
              for (const g of obj["@graph"]) collect(g);
            }
          };
          if (Array.isArray(parsed)) parsed.forEach(collect);
          else collect(parsed);
        } catch {
          // Malformed JSON-LD is itself a (negative) signal — keep raw.
        }
      });

    const imgs = Array.from(document.querySelectorAll("img"));
    const links = Array.from(
      document.querySelectorAll("a[href]"),
    ) as HTMLAnchorElement[];
    let internal = 0;
    let external = 0;
    for (const a of links) {
      try {
        const u = new URL(a.href, location.href);
        if (u.origin === location.origin) internal++;
        else external++;
      } catch {
        /* skip */
      }
    }

    const text = document.body?.innerText ?? "";

    const computedFamily = (sel: string): string => {
      const el = document.querySelector(sel);
      if (!el) return "";
      const f = window.getComputedStyle(el).fontFamily ?? "";
      return f.replace(/\s+/g, " ").trim();
    };
    const fonts = {
      heading:
        computedFamily("h1") ||
        computedFamily("h2") ||
        computedFamily("h3") ||
        "",
      body: computedFamily("body") || computedFamily("p") || "",
    };

    return {
      title: document.title ?? "",
      description: meta('meta[name="description"]'),
      keywords: meta('meta[name="keywords"]'),
      canonical: meta('link[rel="canonical"]', "href"),
      lang: document.documentElement.lang ?? "",
      viewport: meta('meta[name="viewport"]'),
      robots: meta('meta[name="robots"]'),
      og: {
        title: meta('meta[property="og:title"]'),
        description: meta('meta[property="og:description"]'),
        image: meta('meta[property="og:image"]'),
        type: meta('meta[property="og:type"]'),
        url: meta('meta[property="og:url"]'),
        site_name: meta('meta[property="og:site_name"]'),
      },
      twitter: {
        card: meta('meta[name="twitter:card"]'),
        title: meta('meta[name="twitter:title"]'),
        description: meta('meta[name="twitter:description"]'),
      },
      h1s: Array.from(document.querySelectorAll("h1"))
        .map((h) => (h.textContent ?? "").trim())
        .filter(Boolean)
        .slice(0, 5),
      h2s: Array.from(document.querySelectorAll("h2"))
        .map((h) => (h.textContent ?? "").trim())
        .filter(Boolean)
        .slice(0, 12),
      jsonLdTypes: ldTypes,
      jsonLdRaw: ldRaw,
      imageCount: imgs.length,
      imagesWithAlt: imgs.filter((i) => (i.alt ?? "").trim().length > 0).length,
      internalLinks: internal,
      externalLinks: external,
      hasFaq:
        ldTypes.some((t) => /faq/i.test(t)) ||
        /frequently asked/i.test(text) ||
        Array.from(document.querySelectorAll("h2, h3")).some((h) =>
          /faq|frequently asked/i.test(h.textContent ?? ""),
        ),
      hasContactInfo:
        /\b(?:contact|tel|phone|email)\b/i.test(text) &&
        Array.from(
          document.querySelectorAll('a[href^="mailto:"], a[href^="tel:"]'),
        ).length > 0,
      scriptCount: document.querySelectorAll("script").length,
      textLength: text.length,
      fonts,
    };
  });

  return {
    url,
    https: url.startsWith("https://"),
    ...data,
  };
}

// Compact text rendering of the snapshot for AI grounding. Keeps tokens
// down by skipping fields that aren't strong signals.
export function snapshotToPrompt(s: SeoSnapshot): string {
  const lines = [
    `URL: ${s.url} (HTTPS: ${s.https})`,
    `Title: ${s.title || "(missing)"} [${s.title.length} chars]`,
    `Description: ${s.description || "(missing)"} [${s.description.length} chars]`,
    `Canonical: ${s.canonical || "(missing)"}`,
    `Lang: ${s.lang || "(missing)"}`,
    `Viewport: ${s.viewport || "(missing)"}`,
    `Robots: ${s.robots || "(default)"}`,
    `OG: title=${q(s.og.title)} desc=${q(s.og.description)} image=${q(s.og.image)} type=${q(s.og.type)}`,
    `Twitter: card=${q(s.twitter.card)} title=${q(s.twitter.title)}`,
    `H1s (${s.h1s.length}): ${s.h1s.map(q).join(" | ") || "(none)"}`,
    `H2s (${s.h2s.length}): ${s.h2s.slice(0, 8).map(q).join(" | ") || "(none)"}`,
    `JSON-LD types: ${s.jsonLdTypes.join(", ") || "(none)"}`,
    `Images: ${s.imagesWithAlt}/${s.imageCount} with alt`,
    `Links: ${s.internalLinks} internal / ${s.externalLinks} external`,
    `Has FAQ-style content: ${s.hasFaq}`,
    `Has contact link (mailto/tel): ${s.hasContactInfo}`,
    `Body text length: ${s.textLength} chars, scripts: ${s.scriptCount}`,
    `Fonts: heading=${q(s.fonts.heading)} body=${q(s.fonts.body)}`,
  ];
  return lines.join("\n");
}

function q(s: string): string {
  if (!s) return "(empty)";
  const t = s.replace(/\s+/g, " ").slice(0, 80);
  return `"${t}"`;
}

export function writeSnapshot(snapshot: SeoSnapshot, path: string): void {
  writeFileSync(path, JSON.stringify(snapshot, null, 2), "utf8");
}
