import { type Browser, type Page, chromium } from "playwright";
import { type BusinessRecord, emptyRecord } from "./types.ts";
import { nowIso, placeIdFromUrl, sleep } from "./util.ts";

// Scrape Google Maps for a search query. Strategy:
//   1. Open google.com/maps/search/<query>
//   2. Scroll the results feed (`div[role=feed]`) until the end-of-list
//      marker appears or no new items load for a few iterations.
//   3. Click each result to open the details panel and read fields out.
//
// Caveats: Google may serve a consent gate or rate-limit aggressively.
// Run headed locally first to get past consent in your browser profile,
// or set HEADFUL=1.

export interface MapsScrapeOptions {
  query: string;
  maxResults?: number;
  headful?: boolean;
  // ms to wait between detail clicks; high enough to avoid CAPTCHA but
  // low enough to make progress. 600 is a good baseline.
  perItemDelayMs?: number;
}

export interface ScrapedListing extends Partial<BusinessRecord> {
  place_id: string;
  name: string;
}

async function dismissConsent(page: Page) {
  // Consent dialog selectors vary by region; click the first plausible "accept" button.
  const candidates = [
    'button:has-text("Accept all")',
    'button:has-text("I agree")',
    'button[aria-label*="Accept"]',
    'form[action*="consent"] button',
  ];
  for (const sel of candidates) {
    const btn = page.locator(sel).first();
    if (await btn.count().catch(() => 0)) {
      await btn.click({ timeout: 2000 }).catch(() => {});
      await sleep(500);
      return;
    }
  }
}

async function scrollFeedToEnd(
  page: Page,
  maxResults: number,
  onProgress?: (count: number) => void,
) {
  const feed = page.locator('div[role="feed"]');
  await feed.first().waitFor({ timeout: 30_000 });

  let lastCount = 0;
  let stagnant = 0;
  const STAGNANT_LIMIT = 6;

  while (stagnant < STAGNANT_LIMIT) {
    await feed.first().evaluate((el) => {
      el.scrollBy(0, el.clientHeight * 2);
    });
    await sleep(800);

    // End-of-list marker that Google injects.
    const end = await page
      .locator("text=You've reached the end of the list")
      .count()
      .catch(() => 0);

    const count = await page
      .locator('div[role="feed"] > div > div[jsaction] a.hfpxzc')
      .count()
      .catch(() => 0);

    if (onProgress) onProgress(count);

    if (count >= maxResults) break;
    if (end > 0) break;
    if (count === lastCount) stagnant++;
    else stagnant = 0;
    lastCount = count;
  }
}

async function readDetailsPanel(page: Page): Promise<Partial<BusinessRecord>> {
  // The details panel is a sibling region. Wait for the H1 to appear.
  const h1 = page.locator("h1").first();
  await h1.waitFor({ timeout: 15_000 }).catch(() => {});
  const name = (await h1.textContent().catch(() => "")) ?? "";

  const grab = async (sel: string): Promise<string> => {
    const el = page.locator(sel).first();
    if (!(await el.count().catch(() => 0))) return "";
    const text = (await el.textContent().catch(() => "")) ?? "";
    return text.trim();
  };

  const grabAria = async (re: RegExp): Promise<string> => {
    const handle = await page
      .locator(`button[aria-label], a[aria-label]`)
      .elementHandles();
    for (const h of handle) {
      const a = await h.getAttribute("aria-label").catch(() => null);
      if (a && re.test(a)) {
        return a.replace(re, "$1").trim();
      }
    }
    return "";
  };

  // Address / phone / website use stable data-item-ids.
  const address = await grab('button[data-item-id="address"] div.fontBodyMedium');
  const phone = await grab('button[data-item-id^="phone"] div.fontBodyMedium');
  const website = (await page
    .locator('a[data-item-id="authority"]')
    .first()
    .getAttribute("href")
    .catch(() => null)) ?? "";

  // Category sits in a button.DkEaL near the H1.
  const category = await grab("button.DkEaL");

  // Rating + review count appear in role=img labels and adjacent text.
  const rating = await grabAria(/^([\d.]+)\s+stars?$/i);
  const reviewsCount = await grabAria(/^([\d,]+)\s+reviews?$/i);

  // Hours sit behind a "Hours" disclosure; just grab the first table-ish text.
  const hours = await grab('div[aria-label*="Hours"]');

  // Lat/lng come out of the URL once details are loaded: /@lat,lng,...
  const url = page.url();
  const latlng = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);

  return {
    name: name.trim(),
    address,
    phone,
    website,
    category,
    rating,
    reviews_count: reviewsCount,
    hours,
    latitude: latlng?.[1] ?? "",
    longitude: latlng?.[2] ?? "",
    maps_url: url,
    place_id: placeIdFromUrl(url),
  };
}

export interface ScraperEvents {
  onScrolled?: (count: number) => void;
  onListing?: (listing: ScrapedListing) => void;
}

export async function scrapeGoogleMaps(
  opts: MapsScrapeOptions,
  events: ScraperEvents = {},
): Promise<ScrapedListing[]> {
  const maxResults = opts.maxResults ?? 50;
  const perItemDelayMs = opts.perItemDelayMs ?? 600;

  const browser: Browser = await chromium.launch({
    headless: !opts.headful,
  });
  const context = await browser.newContext({
    locale: "en-US",
    viewport: { width: 1400, height: 900 },
  });
  const page = await context.newPage();

  try {
    const url = `https://www.google.com/maps/search/${encodeURIComponent(opts.query)}/`;
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await dismissConsent(page);

    await scrollFeedToEnd(page, maxResults, events.onScrolled);

    const anchors = await page.locator('a.hfpxzc').elementHandles();
    const limit = Math.min(anchors.length, maxResults);
    const results: ScrapedListing[] = [];

    for (let i = 0; i < limit; i++) {
      const a = anchors[i];
      const href = (await a.getAttribute("href").catch(() => "")) ?? "";
      const preId = placeIdFromUrl(href);

      // Click and wait for URL to swap; sometimes the anchor click is
      // intercepted, fall back to navigating directly.
      await a.click({ timeout: 5000 }).catch(async () => {
        if (href) await page.goto(href).catch(() => {});
      });
      await sleep(perItemDelayMs);

      const details = await readDetailsPanel(page).catch(() => ({}));
      const partial: ScrapedListing = {
        ...emptyRecord(),
        ...details,
        place_id:
          (details as Partial<BusinessRecord>).place_id || preId || "",
        query: opts.query,
        scraped_at: nowIso(),
        name: (details as Partial<BusinessRecord>).name ?? "",
      };

      // Skip listings we couldn't even resolve a name for.
      if (!partial.name) continue;
      results.push(partial);
      events.onListing?.(partial);
    }

    return results;
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
