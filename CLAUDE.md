# Instructions for Claude

This repo hosts an arbitrary number of statically-exported sites on
Cloudflare. You are expected to add new sites here freely. Follow the
conventions below.

## Stack (do not deviate)

- **Next.js** (App Router, `output: 'export'`) + React + TypeScript for every site
- **oxlint** for linting, **oxfmt** for formatting
- **better-npm-audit** for dependency security checks
- **@tanstack/react-table** for tables
- **@tanstack/react-query** for async/server state (NOT for client UI state)
- **@tanstack/react-pacer** for debounce / throttle / rate limiting
- **@tanstack/react-virtual** for virtualizing long lists
- **Turborepo** for the monorepo
- **npm** (workspaces) for the package manager - never pnpm or yarn
- **GitHub Actions** for CI/CD
- **Cloudflare Workers + R2** for hosting

The TanStack libs are already installed in `sites/example/`, so any new site
scaffolded from the template inherits them.

## Adding a new site

Always use the scaffold script. It guarantees the package name and hostname
field are wired up correctly, which is what the deploy workflow keys off of.

```bash
npm run new-site -- --name=<kebab-case> --hostname=<sub>.example.com \
                    --title="<Title>" --description="<one-liner>"
npm install
```

Then edit `sites/<name>/src/app/` like any Next.js App Router project. The
site will deploy on the next push to `main`.

## Conventions, do not break them

- Every site lives at `sites/<name>/` and only there.
- Every site's `package.json` MUST have:
  - `"name": "@sites/<name>"`
  - `"site": { "hostname", "title", "description" }` — single source of
    truth for per-site metadata; `src/lib/site-config.ts` reads from
    here, and metadata, OG image, sitemap, manifest, and JSON-LD all
    derive from it
  - a `"build"` script that emits to `dist/` (Next.js exports to `out/`
    by default; the template's `build` script renames it to `dist/` so
    the deploy pipeline keeps working unchanged)
- Every site's `next.config.mjs` MUST set `output: "export"` so the build
  produces a fully static export uploadable to R2.
- Hostnames are lowercase and must be a subdomain of the configured apex.
- Do not add a per-site GitHub Actions workflow. The single root workflow
  fans out across all sites automatically.
- Do not commit `node_modules`, `dist`, `out`, `.next`, or `.turbo`.
- Do not introduce a different package manager. Use npm.
- Do not introduce a competing state library when react-query covers the
  use case (server data, caching, retries, mutations).

## What lives where

- `apps/worker/src/index.ts` - the router. Touch only if you need to change
  routing/caching behavior for ALL sites at once.
- `scripts/` - deploy + scaffolding. Touch carefully; changing anything
  here rebuilds every site on next push.
- `sites/example/` - the canonical template. `new-site` copies it.
- `sites/<name>/src/lib/site-config.ts` - reads `package.json`'s `site`
  field; the single source of truth for title/description/hostname.
- `sites/<name>/src/components/Analytics.tsx` - GA4 + Consent Mode v2 setup.
- `sites/<name>/src/components/ConsentBanner.tsx` - the consent UI.
- `sites/<name>/src/components/ConsentSettings.tsx` - consent withdrawal
  UI used on the privacy page.
- `sites/<name>/src/components/WebVitals.tsx` - Core Web Vitals reporter
  that forwards to GA via gtag (consent-aware).
- `sites/<name>/src/components/JsonLd.tsx` - WebSite + Organization
  schema.org JSON-LD for SEO/AEO.
- `sites/<name>/src/components/UnsplashImage.tsx` - server component for
  embedding free stock photos with required attribution.
- `sites/<name>/src/lib/unsplash.ts` - build-time Unsplash API helper.
- `sites/<name>/src/app/{sitemap,robots,manifest}.ts` - auto-generated.
- `sites/<name>/src/app/{icon,apple-icon,opengraph-image}.tsx` -
  auto-generated PNGs via `next/og` `ImageResponse`. Customize the
  layouts to brand each site; the default uses the title's first letter.
- `sites/<name>/src/app/privacy/page.tsx` - privacy notice + cookie
  settings. The consent banner links here.
- `sites/<name>/src/app/{error,not-found}.tsx` - error and 404 pages.

## SEO + AEO

Each site auto-generates everything needed for organic discovery and AEO
(LLM/AI search) directly from `package.json`'s `site` field. Do not
duplicate this metadata anywhere else.

- **Metadata**: `app/layout.tsx` exports a `Metadata` object covering
  `metadataBase`, `title.template`, `description`, `applicationName`,
  canonical alternates, OpenGraph, Twitter cards, and `robots` directives
  with permissive `googleBot` flags.
- **OG image**: `app/opengraph-image.tsx` renders a 1200×630 PNG via
  `next/og` `ImageResponse` at build time. Customize the JSX, but keep
  the file at this exact path so Next auto-wires the `og:image` tag.
- **Favicons**: `app/icon.tsx` (32×32) and `app/apple-icon.tsx` (180×180)
  generate PNGs at build time. Replace with hand-designed assets only
  when a site's brand requires it.
- **JSON-LD**: `<JsonLd />` in the root layout emits `WebSite` and
  `Organization` graphs. Add page-specific schemas (Article,
  BreadcrumbList, FAQPage, etc.) directly in the page that needs them.
- **sitemap.xml + robots.txt**: `app/sitemap.ts` and `app/robots.ts` —
  static-export-safe (`export const dynamic = "force-static"`). Add new
  routes to the sitemap as you add pages.
- **manifest.webmanifest**: `app/manifest.ts` — PWA manifest with theme
  color and icon refs. Same `force-static` requirement.

All metadata routes (`icon`, `apple-icon`, `opengraph-image`,
`manifest.webmanifest`, `sitemap.xml`, `robots.txt`) MUST keep
`export const dynamic = "force-static"` or `next build` will fail under
`output: "export"`.

## Stock images via Unsplash

If a site needs photography, use `<UnsplashImage>` rather than checking
images into the repo. It fetches from the Unsplash API at build time, so
the URL + attribution are baked into the static HTML.

```tsx
import { UnsplashImage } from "../components/UnsplashImage";

<UnsplashImage query="mountains at dawn" width={1600} height={900} />
<UnsplashImage id="3PeSjpLVtLg" /> {/* pinned photo */}
```

- Set `UNSPLASH_ACCESS_KEY` per-site in `.env.production` (free tier:
  50 req/hour). If unset, `<UnsplashImage>` renders nothing — the build
  still succeeds.
- The component renders a `<figcaption>` with photographer + Unsplash
  attribution and triggers the API's download endpoint, which the
  Unsplash license requires. Do not strip these.

## Analytics + consent

Every site ships with GA4 wired up via Google Consent Mode v2:

- Default consent is `denied` for all storage categories. GA runs in
  cookieless-ping mode until the user accepts, so first-load tracking is
  GDPR/ePrivacy-friendly out of the box.
- The `<ConsentBanner />` is mounted in the root layout; clicking Accept
  flips consent to `granted` and persists `localStorage.consent="granted"`,
  which the inline init script restores on subsequent visits.
- The GA measurement ID is read from `NEXT_PUBLIC_GA_ID` at build time. If
  it is unset, neither the gtag scripts nor the banner render. Set it
  per-site in `.env.production` (or in CI matrix env) - do not hardcode it
  into the components.
- Withdrawing consent is mounted on `/privacy/` via `<ConsentSettings />`,
  and the banner links there. The withdraw path resets `gtag` consent to
  `denied` and clears the `localStorage.consent` key (so the banner
  reappears on next visit).
- **Global Privacy Control** is honored: when the browser exposes
  `navigator.globalPrivacyControl === true`, the banner is suppressed,
  `localStorage.consent="granted"` is ignored, and consent stays denied
  for the session. CCPA-mandated in California; treat any change here
  as a compliance change.
- **Web Vitals → GA**: `<WebVitals />` is mounted in the root layout and
  forwards LCP/INP/CLS/FCP/TTFB to GA via the same gtag pipe, so consent
  mode applies (cookieless when denied, attributed when granted). Useful
  for Core Web Vitals SEO signals; no extra setup needed.
- Do not load gtag.js or any other tag manager outside of `Analytics.tsx`.
  Adding a second loader breaks consent state and double-counts pageviews.

## How deploys work

On push to `main`:

1. `scripts/changed-sites.ts` runs and diffs the push.
2. A matrix job builds + uploads each changed site to R2 in parallel.
3. If `apps/worker/` changed, a separate job redeploys the worker.
4. Touching shared root files (`scripts/`, `turbo.json`, `package.json`,
   `package-lock.json`, `tsconfig.base.json`) triggers a rebuild of EVERY
   site, so be deliberate when modifying them.

## Local commands

```bash
npm install                                   # install everything
npm run dev -w @sites/<name>                  # dev server for one site
npm run build -w @sites/<name>                # build one site
npm run build                                 # build everything (cached)
npm run lint                                  # oxlint across the repo
npm run format                                # oxfmt across the repo
npm run audit                                 # better-npm-audit
npm run dev -w site-router                    # run the worker locally
```

## Things to NOT do

- Do not introduce a different framework per site without a strong reason.
  Stick with Next.js (static export) + React + TS so all sites share the
  same tooling.
- Do not switch a site to SSR / ISR / route handlers / server actions. The
  hosting layer is R2 + a static-file router; anything that requires a
  Node runtime will not work in production.
- Do not change the R2 key layout (`<hostname>/<path>`). The worker depends
  on it.
- Do not move or rename `sites/example/` - the scaffold script copies it.
- Do not skip the scaffold script and hand-create site directories. You will
  forget the `site.hostname` field and CI will fail.
- Do not swap oxlint/oxfmt for ESLint/Prettier. The whole point is the
  faster oxc toolchain.
