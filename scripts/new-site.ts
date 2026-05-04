#!/usr/bin/env -S node --experimental-strip-types
// Scaffolds a new Next.js static site by copying sites/example/ and
// rewriting the per-site config in package.json (name + site field).
//
// Per-site title/description live in package.json's "site" field; the
// app reads them at build time via src/lib/site-config.ts so metadata,
// OG image, sitemap, manifest, etc. all stay in sync from one place.
//
// Usage:
//   npm run new-site -- --name=blog --hostname=blog.example.com \
//                       --title="My Blog" --description="Posts from me"
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.join("=")];
  }));

const name = args.name;
const hostnameInput = args.hostname;
const title = args.title ?? args.name;
const description = args.description ?? "";

if (!name || !hostnameInput) {
  console.error(
    "Usage: --name=<dir> --hostname=<host> [--title=<title>] [--description=<desc>]",
  );
  process.exit(1);
}

if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
  console.error(
    "--name must be kebab-case (lowercase letters, digits, hyphens)",
  );
  process.exit(1);
}

// R2 keys are case-sensitive and the worker lowercases the Host header,
// so the hostname stored in package.json must be lowercase too or the
// site will 404 in production.
const hostname = hostnameInput.toLowerCase();
if (
  !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(
    hostname,
  )
) {
  console.error(`--hostname is not a valid DNS name: ${hostnameInput}`);
  process.exit(1);
}

const template = "sites/example";
const dest = join("sites", name);

if (!existsSync(template)) {
  console.error(`Template not found: ${template}`);
  process.exit(1);
}
if (existsSync(dest)) {
  console.error(`Already exists: ${dest}`);
  process.exit(1);
}

cpSync(template, dest, { recursive: true });

const pkgPath = join(dest, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
pkg.name = `@sites/${name}`;
pkg.site = { hostname, title, description };
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

console.log(`Created ${dest}`);
console.log(`  package: @sites/${name}`);
console.log(`  hostname: ${hostname}`);
console.log(`  title: ${title}`);
console.log(`\nNext steps:`);
console.log(`  npm install`);
console.log(`  npm run dev -w @sites/${name}`);
