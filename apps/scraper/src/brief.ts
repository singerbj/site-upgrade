import type { BusinessRecord } from "./types.ts";

// Generates the BRIEF.md that Claude Code reads as its sole spec for the
// new site. It bundles the business profile, the existing-site numbers
// to beat, the feature inventory to preserve, and every hard requirement
// the user spelled out (motion animations, GA, cookie consent, etc).
//
// Keep this file the single source of truth for the spec. Changes here
// flow through to every site Claude Code generates next run.

export interface BriefContext {
  rec: BusinessRecord;
  // Paths are written relative to the site dir so Claude Code reading
  // BRIEF.md from inside sites/<slug>/ resolves them naturally.
  copyRel: string;
  logosRel: string[];
  oldScreenshotRel: string;
}

export function renderBrief(ctx: BriefContext): string {
  const { rec, copyRel, logosRel, oldScreenshotRel } = ctx;

  const oldPerf = rec.lighthouse_performance || "(not measured)";
  const oldA11y = rec.lighthouse_accessibility || "(not measured)";
  const oldBest = rec.lighthouse_best_practices || "(not measured)";
  const oldLhSeo = rec.lighthouse_seo || "(not measured)";
  const oldDesign = rec.ai_design_score || "(not measured)";
  const oldQuality = rec.ai_quality_score || "(not measured)";
  const oldSeo = rec.seo_score || "(not measured)";
  const oldAeo = rec.aeo_score || "(not measured)";
  const oldSeoSummary = rec.seo_summary || "";
  const oldAeoSummary = rec.aeo_summary || "";
  const oldFeatures = rec.ai_features || "(not detected)";
  const oldSummary = rec.ai_summary || "(not generated)";

  const phone = rec.phone || rec.crawl_phones.split(";")[0]?.trim() || "";
  const emails = rec.crawl_emails || "(none extracted)";

  const logosBlock =
    logosRel.length > 0
      ? logosRel.map((p) => `- ${p}`).join("\n")
      : "_(none extracted — design a wordmark from the business name)_";

  return `# BRIEF — ${rec.name}

You are building a redesigned static React + Vite + TypeScript marketing
site for the small business described below. The site already has a
scaffolded \`package.json\`, \`index.html\`, \`src/main.tsx\`, and
\`src/App.tsx\` (copied from \`sites/example/\`). Replace \`src/App.tsx\`
and add any additional source files needed to satisfy this brief.

## Business

| Field | Value |
|---|---|
| Name | ${rec.name} |
| Category | ${rec.category || "(unspecified)"} |
| Address | ${rec.address || "(unknown)"} |
| Phone | ${phone || "(unknown)"} |
| Existing site | ${rec.website || "(none)"} |
| Emails (extracted) | ${emails} |
| Hours | ${rec.hours || "(unknown)"} |
| Maps URL | ${rec.maps_url} |

## Brand assets (already in this directory)

- Homepage screenshot of the existing site: \`${oldScreenshotRel}\`
- All visible copy from the existing site: \`${copyRel}\`
- Logo candidates (use the best one; first listed is highest priority):

${logosBlock}

## Existing site numbers — you must beat all of these

| Metric | Existing | Your target |
|---|---|---|
| Lighthouse performance | ${oldPerf} | ≥ 95 and strictly higher than existing |
| Lighthouse accessibility | ${oldA11y} | ≥ 95 and strictly higher than existing |
| Lighthouse best-practices | ${oldBest} | ≥ 95 |
| Lighthouse SEO | ${oldLhSeo} | ≥ 95 |
| AI SEO score (0-100) | ${oldSeo} | strictly higher |
| AI AEO score (0-100) | ${oldAeo} | strictly higher |
| AI design score (1-10) | ${oldDesign} | strictly higher |
| AI quality score (1-10) | ${oldQuality} | strictly higher |

The pipeline will build your output, run Lighthouse against it, capture
a fresh SEO snapshot, and re-score everything (design, quality, SEO,
AEO) with the same vision model that scored the original. Optimize
for those measurements, not for what looks impressive in code.

Existing-site SEO gap: ${oldSeoSummary}
Existing-site AEO gap: ${oldAeoSummary}

## Features the existing site has — preserve all of them

${oldFeatures || "(none detected — keep at minimum: contact info, hours, services)"}

Existing-site summary from the auditor: ${oldSummary}

## Hard requirements

1. **React + Vite + TypeScript only.** Use the workspace's existing
   tooling. No alternative framework.
2. **\`motion\` library for animation.** Already declared in
   \`package.json\`. Import from \`motion/react\`. Animations must feel
   on-brand for this business — restrained for professional services,
   energetic for retail/food. Do not add gratuitous motion that hurts
   accessibility.
3. **Google Analytics.** Read the GA tag id from
   \`import.meta.env.VITE_GTM_ID\`. If unset, render no analytics
   markup. The user will provide the id later via \`.env.production\`.
4. **Cookie consent banner.**
   - Anchored to the bottom of the viewport.
   - When visible, **pushes the rest of the page content up** (not an
     overlay — content reflows above it).
   - Visual style matches the brand colors derived from the logo /
     existing site.
   - Persists the user's choice to localStorage so it doesn't reappear.
   - Only loads GA after consent.
5. **Accessibility.** Semantic landmarks (header, nav, main, footer),
   labelled controls, sufficient contrast, focus indicators, no
   keyboard traps. \`prefers-reduced-motion\` must disable non-essential
   animation.
6. **Performance.** Single-page static build, no client-side routing
   library unless multiple pages are warranted. Inline critical CSS or
   keep stylesheets small. Defer non-essential JS. Use \`<img loading="lazy">\`
   and provide width/height to avoid CLS. Tree-shake everything.
7. **Build cleanly.** \`npm run build -w @sites/${rec.site_slug}\` from the
   repo root must succeed and produce a working \`dist/\`.
8. **SEO essentials.** Set a unique, specific \`<title>\` (50-60 chars)
   and \`<meta name="description">\` (~150 chars). Include
   \`<link rel="canonical">\`, \`<meta name="viewport">\`, \`<html lang>\`,
   Open Graph + Twitter card tags, and a JSON-LD \`LocalBusiness\` (or
   appropriate schema) block in \`index.html\` populated with the
   business's NAP (name, address, phone). Use a single descriptive H1
   and a sensible H2 outline. Every \`<img>\` needs alt text.
9. **AEO essentials.** Write the homepage to be cite-friendly: a
   one-paragraph "what we do / where / for whom" summary, an explicit
   FAQ section with question-style H3s, and a JSON-LD \`FAQPage\` block
   mirroring those questions. Use plain language statements over
   marketing copy. State the service area, hours, price ranges, and
   accepted payment methods if known.

## Comparison overlay (do not implement)

The pipeline injects a tamper-proof comparison overlay into \`dist/\`
post-build, plus a \`dist/comparison.json\` data file. It loads via a
single \`<script src="/upgrade-overlay.js" defer>\` tag appended before
\`</body>\`. Do not add this script tag yourself — the pipeline does it.
Do not write a \`comparison.json\` or a \`upgrade-overlay.js\` of your
own. Plan layout so the bottom-right ~340×220px area can hold a small
floating card without colliding with the cookie banner that pushes
content up from the bottom.

## Branding direction

Pull palette and typography hints from the homepage screenshot
(\`${oldScreenshotRel}\`). Match the spirit of the brand without copying
the existing layout — the goal is "obviously the same business, but
clearly redesigned and modernized." Use copy from \`${copyRel}\` as the
content source; rewrite for clarity and concision but keep the
business's own voice and any specific service names / offerings.

## Deliverable

When you finish, write a one-paragraph summary of what you built to
\`GENERATION_SUMMARY.md\` in this directory. Cover: chosen palette, key
features implemented, any libraries you added, and any deviations from
this brief.
`;
}
