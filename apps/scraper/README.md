# @apps/scraper

End-to-end lead pipeline. Given a Google Maps search query, it:

1. **Scrapes Google Maps** with Playwright, paginating the results panel
   and capturing each business's name, address, phone, website,
   category, rating, hours, lat/lng, and place_id.
2. **Crawls the existing website** (homepage + a few priority pages),
   extracts every email and phone, pulls logo candidates (header / nav
   imagery, `og:image`, favicon), saves the homepage screenshot, and
   dumps all visible copy.
3. **Captures an SEO snapshot** of the homepage (title, meta tags,
   Open Graph / Twitter cards, headings, JSON-LD schema, alt-text
   coverage, link counts) for grounded AI scoring later.
4. **Runs Lighthouse** against the homepage for performance,
   accessibility, best-practices, and SEO scores.
5. **Scores the design, quality, SEO, and AEO** of the homepage with
   Mistral (`pixtral-large-latest`, vision-capable) using the
   screenshot, the visible copy, and the structured SEO snapshot.
   Design + quality are 1-10; SEO + AEO are 0-100.
6. **Generates a redesigned site** by scaffolding `sites/<slug>/` from
   `sites/example/`, writing a `BRIEF.md` with the captured context
   and every score to beat, then invoking Claude Code as a subprocess
   to build the new React + Vite + TS site.
7. **Evaluates the generated site** by building it, serving `dist/`
   on a local loopback port, capturing a new SEO snapshot, re-running
   Lighthouse, and re-scoring with the same vision model — so the CSV
   has before/after numbers for every metric (Performance,
   Accessibility, Best Practices, SEO, AEO, Design, Quality).
8. **Installs a tamper-proof comparison overlay** into the deployed
   `dist/`. A vanilla-JS Shadow DOM widget reads `/comparison.json` at
   runtime and shows old → new score deltas to anyone visiting the
   demo site, so the prospect sees the value before they sign.

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
    new-screenshot.png        # generated site homepage (pre-overlay)
    copy.txt                  # all visible copy from the existing site
    logos/                    # logo candidates downloaded from the site
    pages/all-pages.html      # raw HTML of every crawled page
    seo-snapshot.json         # head metadata + headings + schema (existing)
    new-seo-snapshot.json     # same shape, captured against the new build
    brand-kit.json            # versioned brand kit; Claude Code reads this
    lighthouse/old.json       # report against the existing site
    lighthouse/new.json       # report against the generated site
  dist/                       # produced by build; gitignored at repo root
    comparison.json           # injected post-build; the overlay reads this
    upgrade-overlay.js        # injected post-build; tamper-proof overlay
    brand-kit.json            # published kit for the deployed viewer
    brand-kit.html            # standalone /brand-kit.html viewer
    assets/logos/             # logos copied for in-browser display
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
npm run scrape -- --query="dentists in Austin TX" --places=40

# Or directly:
npx tsx apps/scraper/src/cli.tsx \
  --query="hvac contractors in Boise ID" --places=30
```

Useful flags:

| Flag                       | Default                | Notes                                                  |
|----------------------------|------------------------|--------------------------------------------------------|
| `--query=<text>`           | required               | Google Maps search string                              |
| `--places=<n>`             | 40                     | Number of businesses to pull from Maps (alias: `--max`) |
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
screenshot_path, copy_path, logo_paths, seo_snapshot_path,
lighthouse_status, lighthouse_performance, lighthouse_accessibility,
lighthouse_best_practices, lighthouse_seo,
ai_status, ai_design_score, ai_quality_score, ai_features, ai_summary,
seo_score, seo_summary, aeo_score, aeo_summary,
brand_palette, brand_voice, brand_tagline, brand_kit_path,
brief_path, generation_status, generation_summary,
new_screenshot_path,
new_lighthouse_status, new_lighthouse_performance,
new_lighthouse_accessibility, new_lighthouse_best_practices,
new_lighthouse_seo,
new_ai_status, new_ai_design_score, new_ai_quality_score,
new_ai_features, new_ai_summary,
new_seo_score, new_seo_summary, new_aeo_score, new_aeo_summary,
comparison_path, error
```

Sort by any `new_*` score minus its `*` counterpart (or the AI design /
SEO / AEO deltas) to surface the biggest wins for outreach.

## Score scales

| Metric | Scale | Source |
|---|---|---|
| `lighthouse_performance` etc | 0-100 | Lighthouse audit |
| `ai_design_score`, `ai_quality_score` | 1-10 | Mistral pixtral vision pass |
| `seo_score`, `aeo_score` | 0-100 | Mistral pixtral with structured SEO snapshot grounding |

Two SEO numbers exist on purpose: `lighthouse_seo` is the mechanical
audit (has title? has meta description? mobile-friendly?), while
`seo_score` is the holistic AI take (does the metadata actually target
search intent? is the JSON-LD relevant? is the heading outline coherent?).
`aeo_score` measures how cite-friendly the page is for LLM-driven search
(Perplexity / ChatGPT / AI Overviews) — clear factual statements, FAQ
schema, semantic HTML, an extractable About paragraph.

## Brand kit

Each business gets a versioned brand kit JSON document at
`sites/<slug>/.assets/brand-kit.json` (and a published copy at
`<hostname>/brand-kit.json` after deploy). The schema (`version: "1"`)
is defined in `src/brand-kit.ts` and lives at the URL
`https://site-upgrade/brand-kit.schema.json` for downstream consumers.

```jsonc
{
  "$schema": "https://site-upgrade/brand-kit.schema.json",
  "version": "1",
  "business": { "name": ..., "tagline": ..., "phone": ..., "emails": [...], ... },
  "identity": { "summary": ..., "voice": ["warm", "authoritative"], "audience": ... },
  "colors":   { "palette": [{ "hex": "#1a4d8c", "role": "primary" }, ...] },
  "typography": {
    "heading": { "family": "Inter", "fallbacks": ["sans-serif"] },
    "body":    { "family": "Inter", "fallbacks": ["sans-serif"] }
  },
  "logos":    [{ "path": ".assets/logos/00-header.svg", "hint": "header", "primary": true }],
  "copy":     { "headlines": [...], "summary": ... },
  "features": [...],
  "sources":  { "captured_from": ..., "captured_at": ..., "screenshot": ..., ... }
}
```

Population:

- `business.*` — straight from the Google Maps + crawl data.
- `identity.voice`, `colors.palette`, `business.tagline` — extracted by
  the same Mistral pass that scores the design (no extra round trip
  through the 1-in-flight Mistral queue).
- `typography.heading/body` — read from the rendered DOM via
  `getComputedStyle` during the crawl.
- `logos` — files downloaded by the crawler (header / nav imagery,
  `og:image`, favicon).
- `copy.headlines` — h1 + h2 text from the SEO snapshot.

After build, `installBrandKit` copies the logos into
`dist/assets/logos/`, rewrites their kit paths to
`/assets/logos/<basename>`, writes `dist/brand-kit.json`, and copies
`templates/brand-kit.html` to `dist/brand-kit.html`. The viewer is a
self-contained vanilla page that fetches `/brand-kit.json` on load and
renders the palette, typography samples (in the actual fonts), logo
gallery, voice tags, headlines, and feature list. Visit
`<slug>.<apex>/brand-kit.html` after deploy.

The kit is also available to Claude Code during generation at
`.assets/brand-kit.json`. The brief instructs Claude to use it as the
source of truth for branding decisions.

## Comparison overlay

After evaluation finishes, the pipeline writes two files into the
new site's `dist/`:

- `dist/comparison.json` — the before/after data shape.
- `dist/upgrade-overlay.js` — a self-contained vanilla-JS Shadow DOM
  widget shipped from `apps/scraper/templates/upgrade-overlay.js`.

It also injects `<script src="/upgrade-overlay.js" defer
data-site-upgrade-overlay></script>` before `</body>` in
`dist/index.html`. The overlay sits at the bottom-right of the page,
shows old → new deltas for every metric, can be minimized or dismissed
for the session, and uses Shadow DOM so the host page's CSS can't break
it. It loads asynchronously and degrades silently if `comparison.json`
is missing.

The overlay is intentionally not part of the React tree — it's
post-processed into `dist/` so even if Claude Code rewrote everything,
the demo still ships with the comparison widget.

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
