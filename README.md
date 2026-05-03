# site-upgrade

Multi-site static hosting on Cloudflare. One Turborepo holds an arbitrary
number of Vite SPAs; each one ships independently to its own subdomain
under a shared apex.

## Architecture

```
*.example.com  ->  Cloudflare edge cache  ->  site-router Worker  ->  R2 bucket "sites"
                                                                       site-a.example.com/...
                                                                       site-b.example.com/...
```

- `apps/worker/` is the only Worker. It reads the `Host` header and serves
  the matching prefix out of a single R2 bucket.
- `sites/<name>/` is one Vite SPA per directory. Its `package.json` declares
  the hostname it ships to via `"site": { "hostname": "..." }`.
- The deploy workflow diffs the push, builds only the sites that changed,
  and uploads each one to R2 in parallel.

## Layout

```
apps/
  worker/                  Cloudflare router Worker
sites/
  example/                 Starter Vite + React + TS SPA
scripts/
  deploy-site.ts           Upload a built site dir to R2
  changed-sites.ts         Detect which sites changed (used by CI)
  new-site.ts              Scaffold a new site from sites/example
  add-domain.ts            Provision a Cloudflare for SaaS Custom Hostname
.github/workflows/
  deploy.yml               Detect -> matrix build -> upload
turbo.json
pnpm-workspace.yaml
```

## Quickstart (local)

```bash
pnpm install
pnpm --filter @sites/example dev          # run the example site
pnpm build                                # build everything (turbo cached)
```

## Adding a new site

```bash
pnpm new-site --name=blog --hostname=blog.example.com --title="Blog"
pnpm install
pnpm --filter @sites/blog dev
```

That's it. Push the new directory to `main` and CI will build and deploy
just that site.

## One-time Cloudflare setup

1. Add your apex (e.g. `example.com`) as a Cloudflare zone.
2. DNS: add `AAAA *  100::` (proxied / orange cloud). Cloudflare auto-issues
   the wildcard cert.
3. Create the R2 bucket: `wrangler r2 bucket create sites`.
4. Edit `apps/worker/wrangler.toml`: set `account_id` and replace the
   two `example.com` references with your apex domain.
5. Deploy the worker locally once: `pnpm --filter site-router deploy`.

## GitHub Actions secrets

The deploy workflow needs:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN` (Workers Scripts:Edit, Workers R2 Storage:Edit, Zone DNS:Edit)
- `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` (R2 -> Manage R2 API Tokens)

## How the change detection works

`scripts/changed-sites.ts` runs in CI, diffs `BASE_SHA..HEAD_SHA`, and
emits a JSON matrix of sites whose directories changed. `apps/worker/`
changes deploy the worker job. Touching anything in the shared root
(`scripts/`, `package.json`, `turbo.json`, etc.) rebuilds every site.

To force a full redeploy, run the workflow manually with the `all` input
checked.

## Customer-owned domains

For BYO domains (`acme.com`), see `scripts/add-domain.ts`. Requires
Cloudflare for SaaS to be enabled on the zone. First 100 custom hostnames
are free; $0.10/mo each after that.

## Free-tier ceilings

| Resource           | Free allowance      |
|--------------------|---------------------|
| Worker requests    | 100k/day (~3M/mo)   |
| R2 storage         | 10 GB               |
| R2 Class A (write) | 1M/mo               |
| R2 Class B (read)  | 10M/mo              |
| Custom hostnames   | 100                 |

Upgrade path: Workers Paid is $5/mo for 10M requests; R2 storage overage
is $0.015/GB/mo.
