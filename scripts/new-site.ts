#!/usr/bin/env -S node --experimental-strip-types
// Scaffolds a new Vite SPA by copying sites/example/ and rewriting the
// package name, hostname, and HTML title.
//
// Usage:
//   npm run new-site -- --name=blog --hostname=blog.example.com [--title="My Blog"]
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.join("=")];
  }));

const name = args.name;
const hostname = args.hostname;
const title = args.title ?? name;

if (!name || !hostname) {
  console.error("Usage: --name=<dir> --hostname=<host> [--title=<title>]");
  process.exit(1);
}

if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
  console.error(
    "--name must be kebab-case (lowercase letters, digits, hyphens)",
  );
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
pkg.site = { hostname };
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

const indexPath = join(dest, "index.html");
let html = readFileSync(indexPath, "utf8");
html = html.replace(/<title>.*<\/title>/, `<title>${title}</title>`);
writeFileSync(indexPath, html);

console.log(`Created ${dest}`);
console.log(`  package: @sites/${name}`);
console.log(`  hostname: ${hostname}`);
console.log(`\nNext steps:`);
console.log(`  npm install`);
console.log(`  npm run dev -w @sites/${name}`);
