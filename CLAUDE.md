# Instructions for Claude

This repo hosts an arbitrary number of static SPAs on Cloudflare. You are
expected to add new sites here freely. Follow the conventions below.

## Adding a new site

Always use the scaffold script. It guarantees the package name and hostname
field are wired up correctly, which is what the deploy workflow keys off of.

```bash
pnpm new-site --name=<kebab-case> --hostname=<sub>.example.com --title="<Title>"
pnpm install
```

Then edit `sites/<name>/src/` like any Vite + React + TS project. The site
will deploy on the next push to `main`.

## Conventions, do not break them

- Every site lives at `sites/<name>/` and only there.
- Every site's `package.json` MUST have:
  - `"name": "@sites/<name>"`
  - `"site": { "hostname": "<sub>.example.com" }`
  - a `"build"` script that emits to `dist/`
- Hostnames are lowercase and must be a subdomain of the configured apex.
- Do not add a per-site GitHub Actions workflow. The single root workflow
  fans out across all sites automatically.
- Do not commit `node_modules`, `dist`, or `.turbo`.

## What lives where

- `apps/worker/src/index.ts` - the router. Touch only if you need to change
  routing/caching behavior for ALL sites at once.
- `scripts/` - deploy + scaffolding. Touch carefully; changing anything
  here rebuilds every site on next push.
- `sites/example/` - the canonical template. `new-site` copies it.

## How deploys work

On push to `main`:

1. `scripts/changed-sites.ts` runs and diffs the push.
2. A matrix job builds + uploads each changed site to R2 in parallel.
3. If `apps/worker/` changed, a separate job redeploys the worker.
4. Touching shared root files (`scripts/`, `turbo.json`, `package.json`,
   `pnpm-lock.yaml`, `tsconfig.base.json`) triggers a rebuild of EVERY
   site, so be deliberate when modifying them.

## Local commands

```bash
pnpm install                                  # install everything
pnpm --filter @sites/<name> dev               # dev server for one site
pnpm --filter @sites/<name> build             # build one site
pnpm build                                    # build everything (cached)
pnpm --filter site-router dev                 # run the worker locally
```

## Things to NOT do

- Do not introduce a different framework per site without a strong reason.
  Stick with React + Vite + TS so all sites share the same tooling.
- Do not change the R2 key layout (`<hostname>/<path>`). The worker depends
  on it.
- Do not move or rename `sites/example/` - the scaffold script copies it.
- Do not skip the scaffold script and hand-create site directories. You will
  forget the `site.hostname` field and CI will fail.
