# @apps/scraper

End-to-end lead pipeline. Given a Google Maps search query, it:

1. **Scrapes Google Maps** with Playwright, paginating the results panel
   and capturing each business's name, address, phone, website,
   category, rating, hours, lat/lng, and place_id.
2. **Crawls the existing website** (homepage + a few priority pages),
   extracts every email and phone, pulls logo candidates (header / nav
   imagery, `og:image`, favicon), saves the homepage screenshot, and
   dumps all visible copy.
3. **Runs Lighthouse** against the homepage for performance,
   accessibility, best-practices, and SEO scores.
4. **Scores the design and quality** of the homepage with the AI SDK +
   Mistral (`pixtral-large-latest`, vision-capable) using the screenshot.
5. **Generates a redesigned site** by scaffolding `sites/<slug>/` from
   `sites/example/`, writing a `BRIEF.md` with the captured context and
   the targets to beat, then invoking Claude Code as a subprocess to
   build the new React + Vite + TS site in that directory.
6. **Evaluates the generated site** by building it, serving the `dist/`
   on a local loopback port, screenshotting it, re-running Lighthouse,
   and re-scoring the design with the same vision model — so the CSV
   has before/after numbers for every metric.

Everything lands in `data/businesses.csv` — the source of truth, committed
to source control. Re-running the same query is safe: rows already in the
CSV (matched by `place_id`, falling back to a `name|address|website`
hash) are skipped end-to-end.

## Per-business folder layout

Every business gets its own scaffolded site directory. The CSV's
`site_dir` column points here:

```
sites/<slug>/
  package.json                # workspace name + hostname + motion dep
  index.html
  src/                        # Claude Code rewrites src/App.tsx etc.
  BRIEF.md                    # written by the pipeline; Claude reads this
  GENERATION_SUMMARY.md       # written by Claude Code at end of session
  .assets/
    old-screenshot.png        # existing homepage
    new-screenshot.png        # generated site homepage
    copy.txt                  # all visible copy from the existing site
    logos/                    # logo candidates downloaded from the site
    pages/all-pages.html      # raw HTML of every crawled page
    lighthouse/old.json       # report against the existing site
    lighthouse/new.json       # report against the generated site
```

Slug is `<kebab-name>-<6-hex>` derived from the business name + a hash of
the dedup key, so re-runs target the same directory and two businesses
with identical names don't collide.

## Concurrency model

Each stage runs in its own queue, with concurrency tuned to its
bottleneck:

| Stage          | Concurrency | Why                                            |
|----------------|-------------|------------------------------------------------|
| Maps scrape    | 1           | One Playwright browser drives the results UI   |
| Crawl          | 3           | Browser contexts are cheap; sites are slow     |
| Lighthouse     | 2           | CPU-bound (each spawns a fresh Chrome)         |
| Mistral AI     | 1           | Mistral free tier allows 1 in-flight request   |
| Generate       | 1 (default) | Each Claude Code session is heavy; configurable |
| Evaluate       | 1           | Fixed loopback port for the static server      |

AI work is enqueued the moment a screenshot exists; we don't wait for
Lighthouse, so the Mistral queue stays saturated. Each stage flushes its
results to the CSV as soon as it finishes — a crash mid-run never loses
earlier work.

## Setup

```bash
npm install
npm run playwright:install -w @apps/scraper
export MISTRAL_API_KEY=...

# Claude Code must be on PATH (or pass --claude-bin=/path/to/claude).
which claude
```

## Run

```bash
# From the repo root:
npm run scrape -- --query="dentists in Austin TX" --max=40

# Or directly:
npx tsx apps/scraper/src/cli.tsx \
  --query="hvac contractors in Boise ID" --max=30
```

Useful flags:

| Flag                       | Default                | Notes                                                  |
|----------------------------|------------------------|--------------------------------------------------------|
| `--query=<text>`           | required               | Google Maps search string                              |
| `--max=<n>`                | 40                     | Max results to scrape from Maps                        |
| `--apex=<domain>`          | `example.com`          | Per-site hostname is `<slug>.<apex>`                   |
| `--headful`                | off                    | Show the Playwright browser window                     |
| `--no-lighthouse`          | off                    | Skip the existing-site Lighthouse stage                |
| `--no-ai`                  | off                    | Skip Mistral assessment (both old and new site)        |
| `--no-generation`          | off                    | Skip Claude Code generation                            |
| `--no-evaluation`          | off                    | Skip building/scoring the new site                     |
| `--gen-concurrency=<n>`    | 1                      | Parallel Claude Code sessions (raise carefully)        |
| `--model=<id>`             | `pixtral-large-latest` | Override the Mistral model (must be vision-capable)    |
| `--csv=<path>`             | `data/businesses.csv`  | Override CSV location                                  |
| `--claude-bin=<path>`      | `claude`               | Path to the Claude Code CLI (also `CLAUDE_BIN` env)    |

## What Claude Code is told to build

The pipeline writes `BRIEF.md` into each `sites/<slug>/` and invokes
`claude --print --dangerously-skip-permissions` with `cwd=sites/<slug>/`.
Every constraint lives in the brief:

- Same features as the existing site (extracted by the AI auditor).
- Lighthouse performance + accessibility scores must beat the existing
  numbers and clear 95.
- Design score must beat the existing one (re-scored after build).
- Brand-relevant animations powered by `motion` (imported from
  `motion/react`); already declared in `package.json`.
- Google Analytics gated behind cookie consent. The script reads the
  measurement id from `import.meta.env.VITE_GTM_ID`; the operator
  supplies it later via `.env.production`.
- Cookie consent banner anchored at the bottom that **pushes content up**
  (not an overlay), styled to match the brand colors derived from the
  homepage screenshot, and persists the choice to localStorage.

`BRIEF.md` is committed alongside the generated code so the brief is
auditable. `GENERATION_SUMMARY.md` (written by Claude at end of session)
is captured into the CSV's `generation_summary` column.

## CSV columns

Identity + Maps fields, then per-stage status + outputs:

```
site_dir, site_slug, site_hostname,
crawl_status, crawl_pages, crawl_emails, crawl_phones,
screenshot_path, copy_path, logo_paths,
lighthouse_status, lighthouse_performance, lighthouse_accessibility,
lighthouse_best_practices, lighthouse_seo,
ai_status, ai_design_score, ai_quality_score, ai_features, ai_summary,
brief_path, generation_status, generation_summary,
new_screenshot_path,
new_lighthouse_status, new_lighthouse_performance,
new_lighthouse_accessibility, new_lighthouse_best_practices,
new_lighthouse_seo,
new_ai_status, new_ai_design_score, new_ai_quality_score,
new_ai_features, new_ai_summary,
error
```

Sort the CSV by `new_lighthouse_performance` minus
`lighthouse_performance` (or the AI design delta) to surface the biggest
wins.

## Caveats

- Google Maps will rate-limit aggressive scraping. Run `--headful` once
  to clear consent in your local browser profile, then headless.
- Lighthouse needs Chrome on the host. `chrome-launcher` finds it
  automatically; set `CHROME_PATH` to override.
- Claude Code generation is **not deterministic** and is **expensive**
  (real API tokens). Default concurrency is 1 so you don't accidentally
  fan out to dozens of parallel sessions. Use `--no-generation` while
  iterating on the data-collection stages.
- The static server uses a fixed port (5193) so the evaluate queue is
  serial. If you raise it, give each task its own port.
