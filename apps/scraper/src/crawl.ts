import { mkdirSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { type Browser, chromium } from "playwright";
import {
  extractEmails,
  extractPhones,
  originOf,
  resolveUrl,
  uniq,
} from "./util.ts";

// Crawls the homepage + a small set of in-origin internal links (about,
// contact, etc) and writes everything we'll need for redesign downstream:
// homepage screenshot, copy.txt, page HTML, and a few logo candidates.
// All artifacts land under a single per-site assets dir so the CSV only
// needs to reference one folder per business.

export interface CrawlResult {
  url: string;
  pages: number;
  emails: string[];
  phones: string[];
  screenshotPath: string;
  copyPath: string;
  logoPaths: string[];
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
  "/services",
  "/menu",
  "/products",
  "/info",
];

const MAX_PAGES = 6;
const PAGE_TIMEOUT_MS = 25_000;
const MAX_LOGOS = 4;

// Run inside the page; collects logo / brand-mark image candidates.
// We score by location + filename hints and return the most promising
// few. The host-side downloader picks them up.
const collectLogoCandidates = `() => {
  const out = [];
  const score = (url, hint) => {
    if (!url) return;
    out.push({ url, hint });
  };
  // Header / nav imagery is almost always the logo.
  document.querySelectorAll("header img, nav img").forEach((img) => {
    score(img.src, "header");
  });
  // Anything with "logo" or "brand" in alt/src/class.
  document.querySelectorAll("img").forEach((img) => {
    const haystack = ((img.alt || "") + " " + (img.src || "") + " " + (img.className || "")).toLowerCase();
    if (haystack.includes("logo") || haystack.includes("brand")) score(img.src, "named");
  });
  // og:image / twitter:image as fallback brand artwork.
  const og = document.querySelector('meta[property="og:image"]');
  if (og && og.content) score(og.content, "og:image");
  const tw = document.querySelector('meta[name="twitter:image"]');
  if (tw && tw.content) score(tw.content, "twitter:image");
  // Favicon last-resort.
  const icon = document.querySelector('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]');
  if (icon && icon.href) score(icon.href, "favicon");
  return out;
}`;

interface LogoCandidate {
  url: string;
  hint: string;
}

export async function crawlSite(
  url: string,
  assetsDir: string,
  pagesDir: string,
): Promise<CrawlResult> {
  const origin = originOf(url);
  if (!origin) throw new Error(`Invalid URL: ${url}`);

  mkdirSync(assetsDir, { recursive: true });
  mkdirSync(pagesDir, { recursive: true });
  const logosDir = join(assetsDir, "logos");
  mkdirSync(logosDir, { recursive: true });

  const screenshotPath = join(assetsDir, "old-screenshot.png");
  const copyPath = join(assetsDir, "copy.txt");

  const browser: Browser = await chromium.launch({ headless: true });
  // Use Playwright's default desktop Chromium UA — small business sites
  // routinely 403 anything declaring itself a bot.
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
  });

  const allText: string[] = [];
  const allHtml: string[] = [];
  const visited = new Set<string>();
  const toVisit: string[] = [url];
  const logoCandidates = new Map<string, string>(); // url -> hint

  try {
    const page = await context.newPage();

    // Homepage first — the screenshot subject and the source for logo
    // candidates.
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

    // Logo candidates from the homepage.
    const cands = await page
      .evaluate<LogoCandidate[]>(collectLogoCandidates as unknown as string)
      .catch(() => [] as LogoCandidate[]);
    for (const c of cands) {
      const abs = resolveUrl(c.url, page.url());
      if (abs && !logoCandidates.has(abs)) logoCandidates.set(abs, c.hint);
    }

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

    // Persist captured data.
    writeFileSync(
      join(pagesDir, "all-pages.html"),
      allHtml.join("\n<!-- next page -->\n"),
      "utf8",
    );
    writeFileSync(copyPath, allText.join("\n\n---\n\n"), "utf8");

    // Download logo candidates via Playwright's request context (carries
    // page cookies, follows redirects). Cap at MAX_LOGOS, prefer earlier
    // candidates (header > named > og > favicon).
    const logoPaths: string[] = [];
    let i = 0;
    for (const [logoUrl, hint] of logoCandidates) {
      if (logoPaths.length >= MAX_LOGOS) break;
      try {
        const res = await context.request.get(logoUrl, { timeout: 10_000 });
        if (!res.ok()) continue;
        const body = await res.body();
        if (body.length === 0 || body.length > 5_000_000) continue;
        const ext = guessExt(logoUrl, res.headers()["content-type"] ?? "");
        const out = join(
          logosDir,
          `${String(i).padStart(2, "0")}-${hint}${ext}`,
        );
        writeFileSync(out, body);
        logoPaths.push(out);
        i++;
      } catch {
        // Move on; logo extraction is best-effort.
      }
    }

    return {
      url,
      pages: visited.size,
      emails,
      phones,
      screenshotPath,
      copyPath,
      logoPaths,
    };
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

function guessExt(url: string, contentType: string): string {
  const fromUrl = extname(new URL(url, "http://x").pathname).toLowerCase();
  if (fromUrl && fromUrl.length <= 5) return fromUrl;
  if (contentType.includes("svg")) return ".svg";
  if (contentType.includes("png")) return ".png";
  if (contentType.includes("jpeg") || contentType.includes("jpg"))
    return ".jpg";
  if (contentType.includes("webp")) return ".webp";
  if (contentType.includes("gif")) return ".gif";
  if (
    contentType.includes("x-icon") ||
    contentType.includes("vnd.microsoft.icon")
  )
    return ".ico";
  return ".bin";
}
