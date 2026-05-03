import { mkdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { assessSite } from "./ai.ts";
import { crawlSite } from "./crawl.ts";
import { CsvStore, dedupKey } from "./csv.ts";
import {
  EVALUATE_PORT,
  buildSite,
  screenshotNewSite,
  serveStatic,
  stopServer,
} from "./evaluate.ts";
import { runClaudeCode, scaffoldSite, writeBrief } from "./generate.ts";
import { type ScrapedListing, scrapeGoogleMaps } from "./google-maps.ts";
import { runLighthouse } from "./lighthouse.ts";
import { Queue, type QueueStats } from "./queue.ts";
import { joinList, normalizeUrl, siteSlug } from "./util.ts";

// The orchestrator wires six stages together with concurrency tuned to
// each stage's bottleneck:
//
//   - Maps scrape: serial (single Playwright browser).
//   - Crawl: parallel (browser-bound but cheap; default 3).
//   - Lighthouse (old): parallel-limited (CPU-bound; default 2).
//   - AI assessment: STRICTLY SERIAL — Mistral allows 1 in-flight request.
//   - Generate (Claude Code subprocess): default 1; each session is heavy.
//   - Evaluate (build + serve + measure): serial (fixed loopback port).
//
// AI work is enqueued the moment a screenshot exists; we don't wait for
// Lighthouse. Generate fires once the existing-site lighthouse + AI both
// finish, because the brief embeds those numbers as targets to beat.
// Evaluate fires once Claude Code returns. Each stage flushes the CSV
// as it finishes so a crash mid-run loses nothing.

export interface PipelineOptions {
  query: string;
  maxResults?: number;
  csvPath: string;
  repoRoot: string;
  apex: string; // e.g. "example.com"; per-site hostname is "<slug>.<apex>"
  crawlConcurrency?: number;
  lighthouseConcurrency?: number;
  generateConcurrency?: number;
  headful?: boolean;
  skipLighthouse?: boolean;
  skipAi?: boolean;
  skipGeneration?: boolean;
  skipEvaluation?: boolean;
  aiModel?: string;
  claudeBin?: string;
}

export type PhaseEvent =
  | { type: "phase"; phase: "maps"; status: "start" | "done"; count?: number }
  | { type: "scrolled"; count: number }
  | { type: "listing"; name: string; total: number; new: number }
  | {
      type: "queues";
      crawl: QueueStats;
      lighthouse: QueueStats;
      ai: QueueStats;
      generate: QueueStats;
      evaluate: QueueStats;
    }
  | {
      type: "item";
      key: string;
      name: string;
      stage: "crawl" | "lighthouse" | "ai" | "generate" | "evaluate";
      status: "start" | "ok" | "error" | "skip";
      detail?: string;
    }
  | { type: "log"; level: "info" | "warn" | "error"; message: string }
  | { type: "summary"; total: number; new: number; processed: number };

export type EventListener = (e: PhaseEvent) => void;

interface SitePaths {
  siteDir: string;
  assetsDir: string;
  pagesDir: string;
  lighthouseDir: string;
  oldScreenshot: string;
  newScreenshot: string;
  copyPath: string;
  briefPath: string;
  hostname: string;
  slug: string;
  packageName: string;
}

export class Pipeline {
  private opts: PipelineOptions;
  private store: CsvStore;
  private listeners = new Set<EventListener>();

  // Queues
  private crawlQ: Queue;
  private lighthouseQ: Queue;
  private aiQ: Queue;
  private generateQ: Queue;
  private evaluateQ: Queue;

  // Per-key state used to gate generate on both lighthouse and AI.
  private readiness = new Map<
    string,
    { lighthouseDone: boolean; aiDone: boolean; paths: SitePaths }
  >();

  constructor(opts: PipelineOptions) {
    this.opts = opts;
    this.store = new CsvStore(opts.csvPath, (err) => {
      this.emit({
        type: "log",
        level: "error",
        message: `csv flush failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    });
    this.crawlQ = new Queue(opts.crawlConcurrency ?? 3);
    this.lighthouseQ = new Queue(opts.lighthouseConcurrency ?? 2);
    // Mistral free tier: 1 in-flight request, period.
    this.aiQ = new Queue(1);
    this.generateQ = new Queue(opts.generateConcurrency ?? 1);
    // Evaluate uses a fixed loopback port — keep serial to avoid clashes.
    this.evaluateQ = new Queue(1);

    const wireQueueEvents = () => {
      const emit = () =>
        this.emit({
          type: "queues",
          crawl: this.crawlQ.stats(),
          lighthouse: this.lighthouseQ.stats(),
          ai: this.aiQ.stats(),
          generate: this.generateQ.stats(),
          evaluate: this.evaluateQ.stats(),
        });
      this.crawlQ.onChange(emit);
      this.lighthouseQ.onChange(emit);
      this.aiQ.onChange(emit);
      this.generateQ.onChange(emit);
      this.evaluateQ.onChange(emit);
    };
    wireQueueEvents();
  }

  on(fn: EventListener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: PhaseEvent) {
    for (const fn of this.listeners) fn(e);
  }

  // Path written to the CSV. Stored relative to the repo root so the
  // CSV is portable across machines and across moves of the checkout.
  private rel(absPath: string): string {
    return relative(this.opts.repoRoot, absPath);
  }

  async run(): Promise<void> {
    const { opts } = this;
    this.emit({ type: "phase", phase: "maps", status: "start" });

    const seenBefore = this.store.count();
    let newCount = 0;
    let totalCount = 0;

    const listings = await scrapeGoogleMaps(
      {
        query: opts.query,
        maxResults: opts.maxResults,
        headful: opts.headful,
      },
      {
        onScrolled: (count) => this.emit({ type: "scrolled", count }),
        // Pre-click dedup using only the place_id we can read off the
        // anchor href — saves the per-item detail click on re-runs.
        shouldSkip: (key) => this.store.has(key),
        onListing: (listing) => {
          totalCount++;
          const key = dedupKey(listing);
          if (this.store.has(key)) {
            this.emit({
              type: "listing",
              name: listing.name,
              total: totalCount,
              new: newCount,
            });
            return;
          }
          newCount++;

          // Reserve the per-business directory immediately so every
          // later stage writes into one stable folder.
          let paths: SitePaths | undefined;
          try {
            paths = this.materializeSiteDir(key, listing);
          } catch (err) {
            this.store.upsert(key, {
              ...listing,
              error: err instanceof Error ? err.message : String(err),
              crawl_status: "error",
              lighthouse_status: "skipped",
              ai_status: "skipped",
              generation_status: "skipped",
              new_lighthouse_status: "skipped",
              new_ai_status: "skipped",
            });
            this.store.flush();
            return;
          }

          const stagePending = !listing.website
            ? "skipped"
            : ("pending" as const);
          this.store.upsert(key, {
            ...listing,
            site_dir: this.rel(paths.siteDir),
            site_slug: paths.slug,
            site_hostname: paths.hostname,
            crawl_status: stagePending,
            lighthouse_status: stagePending,
            ai_status: stagePending,
            generation_status: this.opts.skipGeneration
              ? "skipped"
              : stagePending,
            new_lighthouse_status: this.opts.skipEvaluation
              ? "skipped"
              : stagePending,
            new_ai_status: this.opts.skipEvaluation ? "skipped" : stagePending,
          });
          this.store.flush();
          this.emit({
            type: "listing",
            name: listing.name,
            total: totalCount,
            new: newCount,
          });
          if (listing.website) {
            this.readiness.set(key, {
              lighthouseDone: false,
              aiDone: false,
              paths,
            });
            this.scheduleProcessing(key, listing, paths);
          }
        },
      },
    );

    this.emit({
      type: "phase",
      phase: "maps",
      status: "done",
      count: listings.length,
    });

    // Drain order matters: each downstream stage is scheduled inside the
    // previous stage's task. Drain crawl first, then lighthouse + AI in
    // parallel (these gate generate). Then generate, then evaluate.
    await this.crawlQ.drain();
    await Promise.all([this.lighthouseQ.drain(), this.aiQ.drain()]);
    await this.generateQ.drain();
    await this.evaluateQ.drain();

    await this.store.flush();
    this.emit({
      type: "summary",
      total: this.store.count(),
      new: this.store.count() - seenBefore,
      processed: newCount,
    });
  }

  // Scaffold sites/<slug>/ once and compute every artifact path the
  // pipeline will write into. Idempotent — re-running with the same
  // key reuses the existing directory.
  private materializeSiteDir(key: string, listing: ScrapedListing): SitePaths {
    const slug = siteSlug(listing.name, key);
    const hostname = `${slug}.${this.opts.apex}`;
    const { siteDir } = scaffoldSite({
      repoRoot: this.opts.repoRoot,
      slug,
      hostname,
      title: listing.name,
    });
    const assetsDir = join(siteDir, ".assets");
    const pagesDir = join(assetsDir, "pages");
    const lighthouseDir = join(assetsDir, "lighthouse");
    mkdirSync(assetsDir, { recursive: true });
    mkdirSync(pagesDir, { recursive: true });
    mkdirSync(lighthouseDir, { recursive: true });

    return {
      siteDir,
      assetsDir,
      pagesDir,
      lighthouseDir,
      oldScreenshot: join(assetsDir, "old-screenshot.png"),
      newScreenshot: join(assetsDir, "new-screenshot.png"),
      copyPath: join(assetsDir, "copy.txt"),
      briefPath: join(siteDir, "BRIEF.md"),
      hostname,
      slug,
      packageName: `@sites/${slug}`,
    };
  }

  private scheduleProcessing(
    key: string,
    listing: ScrapedListing,
    paths: SitePaths,
  ) {
    const website = normalizeUrl(listing.website ?? "");
    if (!website) return;

    // 1. Crawl — produces screenshot + extracted contacts + logos + copy.
    this.crawlQ.enqueue(async () => {
      this.store.upsert(key, { crawl_status: "running" });
      this.emit({
        type: "item",
        key,
        name: listing.name ?? "",
        stage: "crawl",
        status: "start",
      });
      try {
        const result = await crawlSite(
          website,
          paths.assetsDir,
          paths.pagesDir,
        );
        this.store.upsert(key, {
          crawl_status: "ok",
          crawl_pages: String(result.pages),
          crawl_emails: joinList(result.emails),
          crawl_phones: joinList(result.phones),
          screenshot_path: this.rel(result.screenshotPath),
          copy_path: this.rel(result.copyPath),
          logo_paths: joinList(result.logoPaths.map((p) => this.rel(p))),
        });
        await this.store.flush();
        this.emit({
          type: "item",
          key,
          name: listing.name ?? "",
          stage: "crawl",
          status: "ok",
          detail: `${result.pages} pages, ${result.emails.length} emails, ${result.logoPaths.length} logos`,
        });

        // Schedule old-site AI assessment immediately — Mistral queue is
        // the bottleneck, keep it saturated.
        if (!this.opts.skipAi) {
          this.scheduleAi(key, listing, paths, result.screenshotPath);
        } else {
          this.markStageDone(key, "ai");
        }
        if (!this.opts.skipLighthouse) {
          this.scheduleLighthouse(key, listing, paths, website);
        } else {
          this.markStageDone(key, "lighthouse");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.store.upsert(key, {
          crawl_status: "error",
          lighthouse_status: "skipped",
          ai_status: "skipped",
          generation_status: "skipped",
          new_lighthouse_status: "skipped",
          new_ai_status: "skipped",
          error: msg,
        });
        await this.store.flush();
        this.emit({
          type: "item",
          key,
          name: listing.name ?? "",
          stage: "crawl",
          status: "error",
          detail: msg,
        });
      }
    });
  }

  private scheduleLighthouse(
    key: string,
    listing: ScrapedListing,
    paths: SitePaths,
    website: string,
  ) {
    this.lighthouseQ.enqueue(async () => {
      this.store.upsert(key, { lighthouse_status: "running" });
      this.emit({
        type: "item",
        key,
        name: listing.name ?? "",
        stage: "lighthouse",
        status: "start",
      });
      try {
        const scores = await runLighthouse(website, paths.lighthouseDir, "old");
        this.store.upsert(key, {
          lighthouse_status: "ok",
          lighthouse_performance: String(scores.performance),
          lighthouse_accessibility: String(scores.accessibility),
          lighthouse_best_practices: String(scores.bestPractices),
          lighthouse_seo: String(scores.seo),
        });
        await this.store.flush();
        this.emit({
          type: "item",
          key,
          name: listing.name ?? "",
          stage: "lighthouse",
          status: "ok",
          detail: `perf=${scores.performance} a11y=${scores.accessibility}`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.store.upsert(key, { lighthouse_status: "error", error: msg });
        await this.store.flush();
        this.emit({
          type: "item",
          key,
          name: listing.name ?? "",
          stage: "lighthouse",
          status: "error",
          detail: msg,
        });
      } finally {
        this.markStageDone(key, "lighthouse");
      }
    });
  }

  private scheduleAi(
    key: string,
    listing: ScrapedListing,
    paths: SitePaths,
    screenshotPath: string,
  ) {
    this.aiQ.enqueue(async () => {
      this.store.upsert(key, { ai_status: "running" });
      this.emit({
        type: "item",
        key,
        name: listing.name ?? "",
        stage: "ai",
        status: "start",
      });
      try {
        let contextText = "";
        try {
          contextText = readFileSync(paths.copyPath, "utf8")
            .replace(/\s+/g, " ")
            .slice(0, 6000);
        } catch {
          contextText = listing.name ?? "";
        }
        const out = await assessSite({
          screenshotPath,
          contextText,
          model: this.opts.aiModel,
        });
        this.store.upsert(key, {
          ai_status: "ok",
          ai_design_score: String(out.design_score),
          ai_quality_score: String(out.quality_score),
          ai_features: joinList(out.features),
          ai_summary: out.summary,
        });
        await this.store.flush();
        this.emit({
          type: "item",
          key,
          name: listing.name ?? "",
          stage: "ai",
          status: "ok",
          detail: `design=${out.design_score} quality=${out.quality_score}`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.store.upsert(key, { ai_status: "error", error: msg });
        await this.store.flush();
        this.emit({
          type: "item",
          key,
          name: listing.name ?? "",
          stage: "ai",
          status: "error",
          detail: msg,
        });
      } finally {
        this.markStageDone(key, "ai");
      }
    });
  }

  // Generate runs only after both lighthouse + AI on the existing site
  // finish, because the brief embeds those numbers as targets to beat.
  private markStageDone(key: string, stage: "lighthouse" | "ai") {
    const r = this.readiness.get(key);
    if (!r) return;
    if (stage === "lighthouse") r.lighthouseDone = true;
    if (stage === "ai") r.aiDone = true;
    if (r.lighthouseDone && r.aiDone) {
      if (this.opts.skipGeneration) return;
      this.scheduleGenerate(key, r.paths);
    }
  }

  private scheduleGenerate(key: string, paths: SitePaths) {
    this.generateQ.enqueue(async () => {
      const rec = this.store.get(key);
      if (!rec) return;

      this.store.upsert(key, { generation_status: "running" });
      this.emit({
        type: "item",
        key,
        name: rec.name,
        stage: "generate",
        status: "start",
      });
      try {
        // logo_paths are stored relative to repoRoot in the CSV;
        // re-absolutize for the brief writer.
        const logoAbsPaths = rec.logo_paths
          .split(";")
          .map((p) => p.trim())
          .filter(Boolean)
          .map((p) => resolve(this.opts.repoRoot, p));
        const briefPath = writeBrief({
          siteDir: paths.siteDir,
          rec,
          copyAbsPath: paths.copyPath,
          logoAbsPaths,
          oldScreenshotAbsPath: paths.oldScreenshot,
        });
        this.store.upsert(key, { brief_path: this.rel(briefPath) });

        const result = await runClaudeCode(paths.siteDir, {
          claudeBin: this.opts.claudeBin,
        });

        if (result.exitCode !== 0) {
          throw new Error(
            `claude exited ${result.exitCode}: ${result.summary || result.output.slice(-300)}`,
          );
        }

        this.store.upsert(key, {
          generation_status: "ok",
          generation_summary: result.summary,
        });
        await this.store.flush();
        this.emit({
          type: "item",
          key,
          name: rec.name,
          stage: "generate",
          status: "ok",
          detail: `${Math.round(result.durationMs / 1000)}s`,
        });

        if (!this.opts.skipEvaluation) this.scheduleEvaluate(key, paths);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.store.upsert(key, {
          generation_status: "error",
          new_lighthouse_status: "skipped",
          new_ai_status: "skipped",
          error: msg,
        });
        await this.store.flush();
        this.emit({
          type: "item",
          key,
          name: rec.name,
          stage: "generate",
          status: "error",
          detail: msg,
        });
      }
    });
  }

  // Evaluation: build the new site, serve dist/ on a fixed loopback
  // port, screenshot it, run Lighthouse, and re-score with the AI.
  // Lighthouse + AI flow through their existing queues so we never
  // exceed the global concurrency caps for either.
  private scheduleEvaluate(key: string, paths: SitePaths) {
    this.evaluateQ.enqueue(async () => {
      const rec = this.store.get(key);
      if (!rec) return;

      this.store.upsert(key, { new_lighthouse_status: "running" });
      this.emit({
        type: "item",
        key,
        name: rec.name,
        stage: "evaluate",
        status: "start",
      });

      let server: ReturnType<typeof serveStatic> | undefined;
      try {
        const build = await buildSite(this.opts.repoRoot, paths.packageName);
        if (!build.ok) {
          throw new Error(
            `build failed: ${build.output.split("\n").slice(-10).join(" | ").slice(0, 500)}`,
          );
        }

        const distDir = resolve(paths.siteDir, "dist");
        server = serveStatic(distDir);
        const url = `http://127.0.0.1:${EVALUATE_PORT}/`;

        // Screenshot the new site for the design-score AI pass.
        await screenshotNewSite(url, paths.newScreenshot);
        this.store.upsert(key, {
          new_screenshot_path: this.rel(paths.newScreenshot),
        });

        // Lighthouse on the new site goes through the shared queue so
        // we never run more than `lighthouseConcurrency` Chromes at once.
        await this.lighthouseQ.run(async () => {
          const scores = await runLighthouse(url, paths.lighthouseDir, "new");
          this.store.upsert(key, {
            new_lighthouse_status: "ok",
            new_lighthouse_performance: String(scores.performance),
            new_lighthouse_accessibility: String(scores.accessibility),
            new_lighthouse_best_practices: String(scores.bestPractices),
            new_lighthouse_seo: String(scores.seo),
          });
        });

        // AI re-score on the new site, through the strict Mistral queue.
        if (!this.opts.skipAi) {
          this.store.upsert(key, { new_ai_status: "running" });
          await this.aiQ.run(async () => {
            const out = await assessSite({
              screenshotPath: paths.newScreenshot,
              contextText: rec.ai_summary,
              model: this.opts.aiModel,
            });
            this.store.upsert(key, {
              new_ai_status: "ok",
              new_ai_design_score: String(out.design_score),
              new_ai_quality_score: String(out.quality_score),
              new_ai_features: joinList(out.features),
              new_ai_summary: out.summary,
            });
          });
        } else {
          this.store.upsert(key, { new_ai_status: "skipped" });
        }

        await this.store.flush();
        const newPerf = this.store.get(key)?.new_lighthouse_performance ?? "";
        const newDesign = this.store.get(key)?.new_ai_design_score ?? "";
        this.emit({
          type: "item",
          key,
          name: rec.name,
          stage: "evaluate",
          status: "ok",
          detail: `perf=${newPerf} design=${newDesign}`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const cur = this.store.get(key);
        this.store.upsert(key, {
          new_lighthouse_status:
            cur?.new_lighthouse_status === "ok" ? "ok" : "error",
          new_ai_status: cur?.new_ai_status === "ok" ? "ok" : "error",
          error: msg,
        });
        await this.store.flush();
        this.emit({
          type: "item",
          key,
          name: rec.name,
          stage: "evaluate",
          status: "error",
          detail: msg,
        });
      } finally {
        if (server) await stopServer(server);
      }
    });
  }
}
