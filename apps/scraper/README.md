# @apps/scraper

Lead-finding pipeline for the site-upgrade business. Given a Google Maps
search query, it:

1. **Scrapes Google Maps** with Playwright, paginating the results panel
   and capturing each business's name, address, phone, website, category,
   rating, hours, lat/lng, and place_id.
2. **Crawls the business's existing website** (homepage + a few priority
   pages like `/contact`, `/about`), extracts every email and phone
   number, and saves a screenshot of the homepage.
3. **Runs Lighthouse** against the homepage for performance + accessibility
   + best-practices + SEO scores.
4. **Scores the design and quality** of the homepage with the AI SDK +
   Mistral (`pixtral-large-latest`, vision-capable) using the screenshot,
   and produces a feature inventory and short summary.

Everything lands in `data/businesses.csv` — the source of truth, committed
to source control. Re-running the same query is safe: rows already in the
CSV (matched by `place_id`, falling back to a `name|address|website`
hash) are skipped end-to-end.

## Concurrency model

Mistral allows only one in-flight request, so AI assessment runs through a
strictly-serial queue. Everything else is parallelized: crawls (default 3
concurrent Playwright contexts), Lighthouse runs (default 2 concurrent
Chrome instances). The orchestrator schedules an AI assessment the
moment a screenshot exists — it does not wait for Lighthouse — so the
Mistral queue stays saturated.

Pipeline shape:

```
Google Maps  ->  for each new listing:
                   crawl (parallel)
                     |-> screenshot ready -> AI queue (serial)
                     '-> lighthouse (parallel)
```

Each stage flushes its results to the CSV as soon as it finishes, so a
crash mid-run never loses earlier work and the CSV always reflects the
current state.

## Setup

```bash
npm install
npm run playwright:install -w @apps/scraper
export MISTRAL_API_KEY=...
```

## Run

```bash
# From the repo root:
npm run scrape -w @apps/scraper -- --query="dentists in Austin TX" --max=40

# Or directly:
npx tsx apps/scraper/src/cli.tsx \
  --query="hvac contractors in Boise ID" --max=30
```

Useful flags:

| Flag                 | Default                | Notes                                       |
|----------------------|------------------------|---------------------------------------------|
| `--query=<text>`     | required               | Google Maps search string                   |
| `--max=<n>`          | 40                     | Max results to scrape from Maps             |
| `--headful`          | off                    | Show the Playwright browser window          |
| `--no-lighthouse`    | off                    | Skip the Lighthouse stage                   |
| `--no-ai`            | off                    | Skip the Mistral assessment stage           |
| `--model=<id>`       | `pixtral-large-latest` | Override the Mistral model (must be vision-capable) |
| `--csv=<path>`       | `data/businesses.csv`  | Override CSV location                       |
| `--data-dir=<path>`  | `data/`                | Override the screenshots/crawls/lh dirs     |

## Data layout

```
data/
  businesses.csv          # the only file checked into git
  screenshots/<key>.png   # gitignored
  crawls/<key>.html       # gitignored
  lighthouse/<key>.json   # gitignored
```

The on-disk artifacts are derivable from the CSV + a re-run, which is why
they're not source-controlled. Re-running with the same query produces
new artifacts only for rows that weren't already in the CSV.

## Caveats

- Google Maps will eventually rate-limit aggressive scraping. Run
  `--headful` once to clear consent dialogs in your local browser
  profile, then go back to headless for production runs.
- Lighthouse needs Chrome on the host. `chrome-launcher` finds it
  automatically; if it can't, install Chrome or set `CHROME_PATH`.
- Phone-number extraction is permissive (regex over visible text),
  filtered to plausible digit counts. Treat it as a candidate set.
