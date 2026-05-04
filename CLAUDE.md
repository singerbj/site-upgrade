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
npm run new-site -- --name=<kebab-case> --hostname=<sub>.example.com --title="<Title>"
npm install
```

Then edit `sites/<name>/src/app/` like any Next.js App Router project. The
site will deploy on the next push to `main`.

## Conventions, do not break them

- Every site lives at `sites/<name>/` and only there.
- Every site's `package.json` MUST have:
  - `"name": "@sites/<name>"`
  - `"site": { "hostname": "<sub>.example.com" }`
  - a `"build"` script that emits to `dist/` (Next.js exports to `out/` by
    default; the template's `build` script renames it to `dist/` so the
    deploy pipeline keeps working unchanged)
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
- `sites/<name>/src/components/Analytics.tsx` - GA4 + Consent Mode v2 setup.
- `sites/<name>/src/components/ConsentBanner.tsx` - the consent UI.

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
