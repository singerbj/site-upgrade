#!/usr/bin/env -S node --experimental-strip-types
// Detects which sites (and whether the worker) need to be redeployed,
// by diffing files between BASE_SHA and HEAD_SHA. Emits JSON to stdout:
//   { "sites": [{ "name", "packageName", "hostname", "dir" }, ...], "worker": boolean }
//
// Used by the GitHub Actions workflow to fan out matrix deploys.
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const sitesDir = "sites";
const workerDir = "apps/worker";

// Touching any of these forces a rebuild of every site.
const sharedPaths = [
  "scripts/",
  "package.json",
  "package-lock.json",
  "turbo.json",
  "tsconfig.base.json",
  ".github/workflows/deploy.yml",
];

interface Site {
  name: string;
  packageName: string;
  hostname: string;
  dir: string;
}

function listSiteDirs(): string[] {
  if (!existsSync(sitesDir)) return [];
  return readdirSync(sitesDir).filter((d) => {
    const p = join(sitesDir, d);
    return (
      statSync(p).isDirectory() && existsSync(join(p, "package.json"))
    );
  });
}

function readSite(dirName: string): Site {
  const pkgPath = join(sitesDir, dirName, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  if (!pkg.site?.hostname) {
    throw new Error(
      `sites/${dirName}/package.json is missing the "site.hostname" field`,
    );
  }
  if (!pkg.name) {
    throw new Error(`sites/${dirName}/package.json is missing the "name" field`);
  }
  return {
    name: dirName,
    packageName: pkg.name,
    hostname: pkg.site.hostname,
    dir: `${sitesDir}/${dirName}`,
  };
}

const baseSha = process.env.BASE_SHA;
const headSha = process.env.HEAD_SHA ?? "HEAD";

const ZERO_SHA = "0000000000000000000000000000000000000000";
let changed: string[] = [];
let allChanged = false;

if (!baseSha || baseSha === ZERO_SHA) {
  // First push or unknown base — rebuild everything.
  allChanged = true;
} else {
  try {
    changed = execSync(`git diff --name-only ${baseSha} ${headSha}`, {
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);
  } catch {
    allChanged = true;
  }
}

const sharedChanged =
  allChanged ||
  changed.some((f) => sharedPaths.some((p) => f.startsWith(p)));

const allSites = listSiteDirs();
const siteNames = sharedChanged
  ? allSites
  : allSites.filter((name) =>
      changed.some((f) => f.startsWith(`${sitesDir}/${name}/`)),
    );

const sites = siteNames.map(readSite);
const workerChanged =
  allChanged ||
  sharedChanged ||
  changed.some((f) => f.startsWith(`${workerDir}/`));

console.log(JSON.stringify({ sites, worker: workerChanged }));
