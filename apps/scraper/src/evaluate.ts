import { spawn } from "node:child_process";
import {
  copyFileSync,
  createReadStream,
  existsSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import type { BusinessRecord } from "./types.ts";

// Build + serve + screenshot the generated site so the existing
// Lighthouse and AI scoring code can run against it. We deliberately
// keep this stage simple: production build via `npm run build`,
// then a tiny static server on a fixed loopback port. Concurrency
// against the same port is the orchestrator's responsibility (the
// evaluate queue is concurrency=1).

const SERVE_PORT = 5193;
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

export interface BuildResult {
  ok: boolean;
  output: string;
  durationMs: number;
}

function runNpm(
  args: string[],
  cwd: string,
): Promise<{ ok: boolean; output: string }> {
  return new Promise((res) => {
    let output = "";
    const proc = spawn("npm", args, {
      cwd,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    proc.stdout.on("data", (d: Buffer) => {
      output += d.toString();
    });
    proc.stderr.on("data", (d: Buffer) => {
      output += d.toString();
    });
    proc.on("error", (err) => {
      res({ ok: false, output: `${err.message}\n${output}` });
    });
    proc.on("close", (code) => {
      res({ ok: code === 0, output });
    });
  });
}

// Build the new site. Runs `npm install` at the repo root first so any
// deps the scaffolder injected (motion) or that Claude Code added during
// generation are present in node_modules. Then `npm run build -w <pkg>`
// produces dist/.
export async function buildSite(
  repoRoot: string,
  packageName: string,
): Promise<BuildResult> {
  const start = Date.now();
  let output = "";

  const install = await runNpm(
    ["install", "--no-audit", "--no-fund"],
    repoRoot,
  );
  output += install.output;
  if (!install.ok) {
    return { ok: false, output, durationMs: Date.now() - start };
  }

  const build = await runNpm(["run", "build", "-w", packageName], repoRoot);
  output += build.output;
  return { ok: build.ok, output, durationMs: Date.now() - start };
}

// Tiny static server. SPA fallback: any path that doesn't resolve to a
// file falls back to /index.html so client-side routing still works.
export function serveStatic(root: string, port: number = SERVE_PORT): Server {
  const server = createServer((req, res) => {
    if (!req.url) {
      res.statusCode = 400;
      res.end("Bad Request");
      return;
    }
    const reqPath = decodeURIComponent(req.url.split("?")[0]);
    let filePath = resolve(root, `.${reqPath}`);
    // Defense against `..` escapes.
    if (!normalize(filePath).startsWith(normalize(root))) {
      res.statusCode = 403;
      res.end("Forbidden");
      return;
    }

    if (existsSync(filePath) && statSync(filePath).isDirectory()) {
      filePath = join(filePath, "index.html");
    }
    if (!existsSync(filePath)) {
      filePath = join(root, "index.html");
    }
    if (!existsSync(filePath)) {
      res.statusCode = 404;
      res.end("Not Found");
      return;
    }

    const ext = extname(filePath).toLowerCase();
    res.setHeader("Content-Type", MIME[ext] ?? "application/octet-stream");
    res.setHeader("Cache-Control", "no-store");
    createReadStream(filePath).pipe(res);
  });
  server.listen(port, "127.0.0.1");
  return server;
}

export function stopServer(server: Server): Promise<void> {
  return new Promise((res) => {
    server.close(() => res());
    // server.close waits for open keep-alives; force-close as a backstop.
    setTimeout(() => res(), 1_000);
  });
}

export async function screenshotNewSite(
  url: string,
  outPath: string,
): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
  });
  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
    await page.screenshot({ path: outPath, fullPage: false, type: "png" });
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

export const EVALUATE_PORT = SERVE_PORT;

// ---------------------------------------------------------------------------
// Comparison overlay injection
// ---------------------------------------------------------------------------
//
// Sales-facing overlay that shows old vs new scores on the deployed site.
// Implemented as a vanilla-JS Shadow DOM widget shipped in the package's
// templates/. We post-process the dist/ output rather than hand the
// component to Claude Code so the overlay is tamper-proof: even if Claude
// rewrites src/App.tsx to do something exotic, the overlay still runs.
//
// Steps:
//   1. Copy templates/upgrade-overlay.js -> dist/upgrade-overlay.js
//   2. Write dist/comparison.json with the per-business numbers.
//   3. Inject `<script src="/upgrade-overlay.js" defer></script>` into
//      dist/index.html if not already present.

const HERE_FILE = fileURLToPath(import.meta.url);
const TEMPLATES_DIR = resolve(HERE_FILE, "..", "..", "templates");
const OVERLAY_TEMPLATE = resolve(TEMPLATES_DIR, "upgrade-overlay.js");
const OVERLAY_SCRIPT_TAG =
  '<script src="/upgrade-overlay.js" defer data-site-upgrade-overlay></script>';

export interface ComparisonData {
  business: { name: string; slug: string; hostname: string };
  generated_at: string;
  old_url: string;
  old_summary: string;
  new_summary: string;
  metrics: Array<{
    label: string;
    old: number | "" | null;
    new: number | "" | null;
    delta: number;
    scale: "100" | "10";
  }>;
}

function num(s: string): number | "" {
  if (!s) return "";
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : "";
}

function delta(a: number | "", b: number | ""): number {
  if (a === "" || b === "") return 0;
  return Math.round((b - a) * 10) / 10;
}

export function buildComparison(rec: BusinessRecord): ComparisonData {
  const m = (
    label: string,
    oldField: keyof BusinessRecord,
    newField: keyof BusinessRecord,
    scale: "100" | "10",
  ) => {
    const o = num(rec[oldField] as string);
    const n = num(rec[newField] as string);
    return { label, old: o, new: n, delta: delta(o, n), scale };
  };

  return {
    business: {
      name: rec.name,
      slug: rec.site_slug,
      hostname: rec.site_hostname,
    },
    generated_at: new Date().toISOString(),
    old_url: rec.website,
    old_summary: rec.ai_summary,
    new_summary: rec.new_ai_summary,
    metrics: [
      m(
        "Performance",
        "lighthouse_performance",
        "new_lighthouse_performance",
        "100",
      ),
      m(
        "Accessibility",
        "lighthouse_accessibility",
        "new_lighthouse_accessibility",
        "100",
      ),
      m(
        "Best practices",
        "lighthouse_best_practices",
        "new_lighthouse_best_practices",
        "100",
      ),
      m("SEO", "seo_score", "new_seo_score", "100"),
      m("AEO", "aeo_score", "new_aeo_score", "100"),
      m("Design", "ai_design_score", "new_ai_design_score", "10"),
      m("Quality", "ai_quality_score", "new_ai_quality_score", "10"),
    ],
  };
}

export interface OverlayInstallResult {
  comparisonPath: string;
  overlayPath: string;
}

export function installOverlay(
  distDir: string,
  data: ComparisonData,
): OverlayInstallResult {
  if (!existsSync(distDir)) {
    throw new Error(`dist not found: ${distDir}`);
  }

  const comparisonPath = join(distDir, "comparison.json");
  writeFileSync(comparisonPath, JSON.stringify(data, null, 2), "utf8");

  const overlayPath = join(distDir, "upgrade-overlay.js");
  copyFileSync(OVERLAY_TEMPLATE, overlayPath);

  // Inject the script tag into dist/index.html before </body>.
  const indexPath = join(distDir, "index.html");
  if (existsSync(indexPath)) {
    let html = readFileSync(indexPath, "utf8");
    if (!html.includes("data-site-upgrade-overlay")) {
      if (html.includes("</body>")) {
        html = html.replace("</body>", `${OVERLAY_SCRIPT_TAG}\n</body>`);
      } else {
        html = `${html}\n${OVERLAY_SCRIPT_TAG}\n`;
      }
      writeFileSync(indexPath, html, "utf8");
    }
  }

  return { comparisonPath, overlayPath };
}
