import { spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { relative, resolve } from "node:path";
import { renderBrief } from "./brief.ts";
import type { BusinessRecord } from "./types.ts";

// Site scaffolding + Claude Code subprocess.
//
// Scaffolding mirrors what scripts/new-site.ts does (copy sites/example,
// rewrite name + hostname) but skips the interactive scaffold script.
// We also inject `motion` into the new site's package.json so Claude
// Code can use it without an extra install step.
//
// Generation uses `claude --print --dangerously-skip-permissions` so a
// single invocation can read the brief, edit files, and run npm — no
// human approvals. The cwd is the new site's directory; combined with
// the brief explicitly forbidding edits outside that directory, this
// keeps blast radius scoped.

const SCAFFOLD_DEPS_TO_ADD: Record<string, string> = {
  // The unified Motion library (formerly framer-motion). Imports from
  // "motion/react" supply the React bindings.
  motion: "^11.0.0",
};

export interface ScaffoldResult {
  siteDir: string;
  hostname: string;
}

export function scaffoldSite(args: {
  repoRoot: string;
  slug: string;
  hostname: string;
  title: string;
}): ScaffoldResult {
  const { repoRoot, slug, hostname, title } = args;
  const template = resolve(repoRoot, "sites/example");
  const dest = resolve(repoRoot, "sites", slug);

  if (!existsSync(template)) {
    throw new Error(`Template not found: ${template}`);
  }

  if (!existsSync(dest)) {
    cpSync(template, dest, { recursive: true });
  }

  // Rewrite package.json: workspace name, hostname, motion dep.
  const pkgPath = resolve(dest, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  pkg.name = `@sites/${slug}`;
  pkg.site = { hostname };
  pkg.dependencies = pkg.dependencies ?? {};
  for (const [k, v] of Object.entries(SCAFFOLD_DEPS_TO_ADD)) {
    if (!pkg.dependencies[k]) pkg.dependencies[k] = v;
  }
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

  // Rewrite the index.html title.
  const indexPath = resolve(dest, "index.html");
  if (existsSync(indexPath)) {
    let html = readFileSync(indexPath, "utf8");
    html = html.replace(/<title>.*<\/title>/, `<title>${title}</title>`);
    writeFileSync(indexPath, html);
  }

  // Each site gets a co-located assets dir for screenshots, logos,
  // copy, lighthouse JSON, brief, etc. Pre-create so subsequent stages
  // can dump into known paths.
  mkdirSync(resolve(dest, ".assets"), { recursive: true });
  mkdirSync(resolve(dest, ".assets/pages"), { recursive: true });
  mkdirSync(resolve(dest, ".assets/lighthouse"), { recursive: true });

  return { siteDir: dest, hostname };
}

export interface BriefWriteArgs {
  siteDir: string;
  rec: BusinessRecord;
  copyAbsPath: string;
  logoAbsPaths: string[];
  oldScreenshotAbsPath: string;
}

export function writeBrief(args: BriefWriteArgs): string {
  const { siteDir, rec, copyAbsPath, logoAbsPaths, oldScreenshotAbsPath } =
    args;

  // Render paths relative to siteDir so Claude Code reading BRIEF.md
  // from inside that dir sees natural paths.
  const rel = (p: string) => relative(siteDir, p);

  const text = renderBrief({
    rec,
    copyRel: rel(copyAbsPath),
    logosRel: logoAbsPaths.map(rel),
    oldScreenshotRel: rel(oldScreenshotAbsPath),
  });

  const briefPath = resolve(siteDir, "BRIEF.md");
  writeFileSync(briefPath, text, "utf8");
  return briefPath;
}

export interface ClaudeCodeResult {
  exitCode: number;
  durationMs: number;
  summary: string;
  output: string;
}

const PROMPT = `Read BRIEF.md in the current directory before doing anything
else. It is the complete spec. Then redesign this site to satisfy every
requirement in the brief. Edit files only inside the current directory.
You may run shell commands (npm install, npm run build, etc) as needed.
When finished, write GENERATION_SUMMARY.md as instructed by the brief.`;

export async function runClaudeCode(
  siteDir: string,
  opts: { claudeBin?: string; timeoutMs?: number } = {},
): Promise<ClaudeCodeResult> {
  const claudeBin = opts.claudeBin ?? process.env.CLAUDE_BIN ?? "claude";
  const timeoutMs = opts.timeoutMs ?? 30 * 60 * 1000; // 30 minutes per site

  const start = Date.now();

  return new Promise<ClaudeCodeResult>((resolveP) => {
    let output = "";
    let killed = false;

    const proc = spawn(
      claudeBin,
      ["--print", "--dangerously-skip-permissions", PROMPT],
      {
        cwd: siteDir,
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    const timer = setTimeout(() => {
      killed = true;
      proc.kill("SIGTERM");
      // Hard-kill if it doesn't exit promptly.
      setTimeout(() => proc.kill("SIGKILL"), 5_000);
    }, timeoutMs);

    proc.stdout.on("data", (d: Buffer) => {
      output += d.toString();
    });
    proc.stderr.on("data", (d: Buffer) => {
      output += d.toString();
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      resolveP({
        exitCode: -1,
        durationMs: Date.now() - start,
        summary: `claude binary not runnable: ${err.message}`,
        output,
      });
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      const summaryPath = resolve(siteDir, "GENERATION_SUMMARY.md");
      let summary = "";
      try {
        summary = readFileSync(summaryPath, "utf8")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 500);
      } catch {
        // No summary file produced — fall back to a tail of the output.
        summary = killed
          ? "timed out"
          : output.split("\n").slice(-5).join(" ").slice(0, 500);
      }
      resolveP({
        exitCode: code ?? -1,
        durationMs: Date.now() - start,
        summary,
        output,
      });
    });
  });
}
