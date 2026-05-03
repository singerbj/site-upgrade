import { spawn } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { chromium } from "playwright";

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
