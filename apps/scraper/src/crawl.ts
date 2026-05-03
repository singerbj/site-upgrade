import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Browser, chromium } from "playwright";
import {
  extractEmails,
  extractPhones,
  originOf,
  safeFilename,
  uniq,
} from "./util.ts";

// Crawls the homepage + a small set of in-origin internal links (about,
// contact, etc). For each page, captures rendered HTML/text and runs
// email/phone regex over the combined corpus. The homepage screenshot is
// kept for the AI quality assessment.

export interface CrawlResult {
  url: string;
  pages: number;
  emails: string[];
  phones: string[];
  screenshotPath: string;
  htmlPath: string;
}

const PRIORITY_PATHS = [
  "/contact",
  "/contact-us",
  "/contact_us",
  "/about",
  "/about-us",
  "/team",
  "/staff",
  "/locations",
  "/info",
];

const MAX_PAGES = 6;
const PAGE_TIMEOUT_MS = 25_000;

export async function crawlSite(
  url: string,
  screenshotsDir: string,
  htmlDir: string,
  key: string,
): Promise<CrawlResult> {
  const origin = originOf(url);
  if (!origin) throw new Error(`Invalid URL: ${url}`);

  mkdirSync(screenshotsDir, { recursive: true });
  mkdirSync(htmlDir, { recursive: true });
  const slug = safeFilename(key);
  const screenshotPath = join(screenshotsDir, `${slug}.png`);
  const htmlPath = join(htmlDir, `${slug}.html`);

  const browser: Browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    userAgent:
      "Mozilla/5.0 (compatible; SiteUpgradeBot/1.0; +https://github.com/singerbj/site-upgrade)",
  });

  const allText: string[] = [];
  const allHtml: string[] = [];
  const visited = new Set<string>();
  const toVisit: string[] = [url];

  try {
    const page = await context.newPage();

    // Homepage first — this is the screenshot subject.
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: PAGE_TIMEOUT_MS,
    });
    await page
      .screenshot({ path: screenshotPath, fullPage: false, type: "png" })
      .catch(() => {});
    visited.add(url);

    const homeHtml = await page.content().catch(() => "");
    const homeText = await page.evaluate(() => document.body?.innerText ?? "");
    allHtml.push(homeHtml);
    allText.push(homeText);

    // Discover internal links on the homepage.
    const links: string[] = await page
      .evaluate((origin: string) => {
        const out: string[] = [];
        for (const a of Array.from(document.querySelectorAll("a[href]"))) {
          const href = (a as HTMLAnchorElement).href;
          try {
            const u = new URL(href);
            if (u.origin === origin) out.push(u.toString().split("#")[0]);
          } catch {
            /* skip */
          }
        }
        return out;
      }, origin)
      .catch(() => [] as string[]);

    // Prioritize "contact"-ish paths, then add the rest, dedup.
    const ranked = [
      ...links.filter((l) =>
        PRIORITY_PATHS.some((p) => l.toLowerCase().includes(p)),
      ),
      ...links,
    ];
    for (const l of uniq(ranked)) toVisit.push(l);

    while (visited.size < MAX_PAGES && toVisit.length) {
      const next = toVisit.shift()!;
      if (visited.has(next)) continue;
      try {
        await page.goto(next, {
          waitUntil: "domcontentloaded",
          timeout: PAGE_TIMEOUT_MS,
        });
        const html = await page.content().catch(() => "");
        const text = await page
          .evaluate(() => document.body?.innerText ?? "")
          .catch(() => "");
        allHtml.push(html);
        allText.push(text);
        visited.add(next);
      } catch {
        // Skip pages that error; we still want partial results.
      }
    }

    const combined = allText.join("\n") + "\n" + allHtml.join("\n");
    const emails = extractEmails(combined);
    const phones = extractPhones(allText.join("\n"));

    writeFileSync(htmlPath, allHtml.join("\n<!-- next page -->\n"), "utf8");

    return {
      url,
      pages: visited.size,
      emails,
      phones,
      screenshotPath,
      htmlPath,
    };
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
