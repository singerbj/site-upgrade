import type { BusinessRecord } from "./types.ts";

// Generates the BRIEF.md that Claude Code reads as its sole spec for
// the new site. Two flavors:
//
//   - Existing-site brief: bundles the captured numbers (Lighthouse,
//     SEO, AEO, design) as targets to beat, and points at the
//     screenshot / copy / logos extracted from the existing site.
//
//   - Greenfield brief: fires when the business has no existing site.
//     Pivots from "beat these numbers" to absolute targets, and
//     points at the invented brand kit + the auto-generated SVG logo.
//
// Both flavors keep the same hard requirements (motion, GA, cookie
// consent, SEO/AEO essentials) so output is consistent across the
// whole CSV.

export interface BriefContext {
  rec: BusinessRecord;
  // Paths are written relative to the site dir so Claude Code reading
  // BRIEF.md from inside sites/<slug>/ resolves them naturally.
  copyRel: string;
  logosRel: string[];
  oldScreenshotRel: string;
}

export function renderBrief(ctx: BriefContext): string {
  const greenfield = !ctx.rec.website;
  return greenfield ? renderGreenfieldBrief(ctx) : renderUpgradeBrief(ctx);
}

function renderUpgradeBrief(ctx: BriefContext): string {
  const { rec, copyRel, logosRel, oldScreenshotRel } = ctx;

  const oldPerf = rec.lighthouse_performance || "(not measured)";
  const oldA11y = rec.lighthouse_accessibility || "(not measured)";
  const oldBest = rec.lighthouse_best_practices || "(not measured)";
  const oldLhSeo = rec.lighthouse_seo || "(not measured)";
  const oldDesign = rec.ai_design_score || "(not measured)";
  const oldQuality = rec.ai_quality_score || "(not measured)";
  const oldSeo = rec.seo_score || "(not measured)";
  const oldAeo = rec.aeo_score || "(not measured)";
  const oldSeoSummary = rec.seo_summary || "(not measured)";
  const oldAeoSummary = rec.aeo_summary || "(not measured)";
  const oldFeatures = rec.ai_features || "(not detected)";
  const oldSummary = rec.ai_summary || "(not generated)";

  const phone = rec.phone || rec.crawl_phones.split(";")[0]?.trim() || "";
  const emails = rec.crawl_emails || "(none extracted)";
  const logosBlock = formatLogos(logosRel);

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

- **Brand kit JSON: \`.assets/brand-kit.json\`** — start here. It's a
  versioned, schema-validated document with the palette (with roles),
  voice tags, tagline, typography, logos, headlines, and identity copy.
  Treat it as the source of truth for branding decisions.
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

${HARD_REQUIREMENTS(rec.site_slug)}

${POST_BUILD_NOTE}

## Branding direction

Pull palette and typography hints from the homepage screenshot
(\`${oldScreenshotRel}\`). Match the spirit of the brand without copying
the existing layout — the goal is "obviously the same business, but
clearly redesigned and modernized." Use copy from \`${copyRel}\` as the
content source; rewrite for clarity and concision but keep the
business's own voice and any specific service names / offerings.

${DELIVERABLE}
`;
}

function renderGreenfieldBrief(ctx: BriefContext): string {
  const { rec, logosRel } = ctx;
  const phone = rec.phone || "";
  const tagline = rec.brand_tagline || "(invent one)";
  const features = rec.ai_features || "(use category-typical features)";
  const summary = rec.ai_summary || "(invent one)";
  const voice = rec.brand_voice || "(invent one)";
  const logosBlock = formatLogos(logosRel);

  return `# BRIEF — ${rec.name} (greenfield)

You are building a static React + Vite + TypeScript marketing site
**from scratch** for the small business described below. There is no
existing website to reference — the pipeline has invented a brand kit
and rendered an SVG logo programmatically before invoking you. Use the
brand kit as the source of truth for every design decision.

The site already has a scaffolded \`package.json\`, \`index.html\`,
\`src/main.tsx\`, and \`src/App.tsx\` (copied from \`sites/example/\`).
Replace \`src/App.tsx\` and add any additional source files needed to
satisfy this brief.

## Business

| Field | Value |
|---|---|
| Name | ${rec.name} |
| Category | ${rec.category || "(unspecified)"} |
| Address | ${rec.address || "(unknown)"} |
| Phone | ${phone || "(unknown)"} |
| Existing site | _none — greenfield_ |
| Hours | ${rec.hours || "(unknown)"} |
| Maps URL | ${rec.maps_url} |
| Tagline (invented) | ${tagline} |
| Voice (invented) | ${voice} |

## Brand assets (already in this directory)

- **Brand kit JSON: \`.assets/brand-kit.json\`** — read this first.
  Versioned, schema-validated, contains the invented palette (with
  roles), voice tags, tagline, audience description, and feature
  hints. **All branding decisions must derive from it.**
- Generated SVG logo (use this verbatim or restyle, but keep the
  monogram + initials so the brand reads consistently):

${logosBlock}

## Targets to hit

There is no existing site to beat, so optimize against absolute
benchmarks. The pipeline will measure your build with Lighthouse, a
fresh SEO snapshot, and the vision-model scorer.

| Metric | Target |
|---|---|
| Lighthouse performance | ≥ 97 |
| Lighthouse accessibility | ≥ 97 |
| Lighthouse best-practices | ≥ 95 |
| Lighthouse SEO | ≥ 95 |
| AI SEO score (0-100) | ≥ 80 |
| AI AEO score (0-100) | ≥ 70 |
| AI design score (1-10) | ≥ 8 |
| AI quality score (1-10) | ≥ 8 |

## Suggested feature inventory (category-appropriate)

${features}

Brand summary (invented): ${summary}

${HARD_REQUIREMENTS(rec.site_slug)}

${POST_BUILD_NOTE}

## Branding direction

Read \`.assets/brand-kit.json\` and use the palette as your design
system foundation. Apply the \`primary\` role for brand accents, the
\`background\` role for surfaces, the \`text\` role for body copy, and
\`accent\` for interactive elements. Use the invented voice tags to
calibrate copy tone. The provided SVG logo is deliberately minimal —
feel free to enhance it visually as long as the monogram + initials
stay legible and the color choices stay inside the kit's palette.

${DELIVERABLE}
`;
}

function formatLogos(logosRel: string[]): string {
  return logosRel.length > 0
    ? logosRel.map((p) => `- ${p}`).join("\n")
    : "_(no logos available — design a wordmark from the business name)_";
}

const HARD_REQUIREMENTS = (slug: string) => `## Hard requirements

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
   - Visual style matches the brand colors from the brand kit.
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
7. **Build cleanly.** \`npm run build -w @sites/${slug}\` from the
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
   accepted payment methods if known.`;

const POST_BUILD_NOTE = `## Comparison overlay + brand kit viewer (do not implement)

The pipeline post-processes \`dist/\` after your build with two
auto-injected artifacts:

- \`dist/comparison.json\` + \`dist/upgrade-overlay.js\` plus a
  \`<script src="/upgrade-overlay.js" defer>\` tag before \`</body>\`.
  The overlay is a Shadow-DOM widget at the bottom-right of every
  page; do not add it yourself.
- \`dist/brand-kit.json\` + \`dist/brand-kit.html\` (a standalone
  brand-kit viewer reachable at \`/brand-kit.html\`). Do not write
  these files; the pipeline generates them from the same brand kit
  you read at \`.assets/brand-kit.json\`.

Plan layout so the bottom-right ~340×220px area can hold a small
floating card without colliding with the cookie banner that pushes
content up from the bottom.`;

const DELIVERABLE = `## Deliverable

When you finish, write a one-paragraph summary of what you built to
\`GENERATION_SUMMARY.md\` in this directory. Cover: chosen palette, key
features implemented, any libraries you added, and any deviations from
this brief.`;
