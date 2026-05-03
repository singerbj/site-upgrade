import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assessSite } from "./ai.ts";
import { crawlSite } from "./crawl.ts";
import { CsvStore, dedupKey } from "./csv.ts";
import { type ScrapedListing, scrapeGoogleMaps } from "./google-maps.ts";
import { runLighthouse } from "./lighthouse.ts";
import { Queue, type QueueStats } from "./queue.ts";
import { joinList } from "./util.ts";

// The orchestrator wires the four stages together with the right
// concurrency profile:
//   - Maps scrape: serial (single Playwright browser).
//   - Crawl: parallel (browser-bound but cheap; default 3).
//   - Lighthouse: parallel-limited (CPU-bound; default 2).
//   - AI assessment: STRICTLY SERIAL — Mistral allows 1 in-flight request.
//
// Crucially, AI work is enqueued the moment a screenshot exists; we don't
// wait for Lighthouse. That keeps the Mistral queue saturated.

export interface PipelineOptions {
  query: string;
  maxResults?: number;
  csvPath: string;
  screenshotsDir: string;
  crawlsDir: string;
  lighthouseDir: string;
  crawlConcurrency?: number;
  lighthouseConcurrency?: number;
  headful?: boolean;
  skipLighthouse?: boolean;
  skipAi?: boolean;
  aiModel?: string;
}

export type PhaseEvent =
  | { type: "phase"; phase: "maps"; status: "start" | "done"; count?: number }
  | { type: "scrolled"; count: number }
  | { type: "listing"; name: string; total: number; new: number }
  | { type: "queues"; crawl: QueueStats; lighthouse: QueueStats; ai: QueueStats }
  | {
      type: "item";
      key: string;
      name: string;
      stage: "crawl" | "lighthouse" | "ai";
      status: "start" | "ok" | "error" | "skip";
      detail?: string;
    }
  | { type: "log"; level: "info" | "warn" | "error"; message: string }
  | { type: "summary"; total: number; new: number; processed: number };

export type EventListener = (e: PhaseEvent) => void;

export class Pipeline {
  private opts: PipelineOptions;
  private store: CsvStore;
  private listeners = new Set<EventListener>();

  // Queues
  private crawlQ: Queue;
  private lighthouseQ: Queue;
  private aiQ: Queue;

  constructor(opts: PipelineOptions) {
    this.opts = opts;
    this.store = new CsvStore(opts.csvPath);
    this.crawlQ = new Queue(opts.crawlConcurrency ?? 3);
    this.lighthouseQ = new Queue(opts.lighthouseConcurrency ?? 2);
    // Mistral free tier: 1 in-flight request, period.
    this.aiQ = new Queue(1);

    const wireQueueEvents = () => {
      const emit = () =>
        this.emit({
          type: "queues",
          crawl: this.crawlQ.stats(),
          lighthouse: this.lighthouseQ.stats(),
          ai: this.aiQ.stats(),
        });
      this.crawlQ.onChange(emit);
      this.lighthouseQ.onChange(emit);
      this.aiQ.onChange(emit);
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

  async run(): Promise<void> {
    const { opts } = this;
    mkdirSync(opts.screenshotsDir, { recursive: true });
    mkdirSync(opts.crawlsDir, { recursive: true });
    mkdirSync(opts.lighthouseDir, { recursive: true });

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
        onListing: (listing) => {
          totalCount++;
          const key = dedupKey(listing);
          if (this.store.has(key)) {
            // Already in CSV — leave existing row alone, no need to
            // re-crawl/re-assess. This is the user's "don't process twice".
            this.emit({
              type: "listing",
              name: listing.name,
              total: totalCount,
              new: newCount,
            });
            return;
          }
          newCount++;
          this.store.upsert(key, {
            ...listing,
            crawl_status: listing.website ? "pending" : "skipped",
            lighthouse_status: listing.website ? "pending" : "skipped",
            ai_status: listing.website ? "pending" : "skipped",
          });
          this.store.flush();
          this.emit({
            type: "listing",
            name: listing.name,
            total: totalCount,
            new: newCount,
          });
          // Schedule downstream work the instant the row is committed.
          if (listing.website) this.scheduleProcessing(key, listing);
        },
      },
    );

    this.emit({ type: "phase", phase: "maps", status: "done", count: listings.length });

    // Drain order matters: lighthouse and AI tasks are *scheduled* from
    // inside crawl tasks. Draining them in parallel with crawl would
    // resolve immediately when their queues are still empty. Wait for
    // crawl first, then drain the downstream stages in parallel.
    await this.crawlQ.drain();
    await Promise.all([this.lighthouseQ.drain(), this.aiQ.drain()]);

    await this.store.flush();
    this.emit({
      type: "summary",
      total: this.store.count(),
      new: this.store.count() - seenBefore,
      processed: newCount,
    });
  }

  private scheduleProcessing(key: string, listing: ScrapedListing) {
    const website = listing.website;
    if (!website) return;

    // 1. Crawl — produces screenshot + extracted contacts.
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
          this.opts.screenshotsDir,
          this.opts.crawlsDir,
          key,
        );
        // Site-discovered phones are kept separate from the Maps phone so
        // each source is auditable. Consumers can union the two columns.
        this.store.upsert(key, {
          crawl_status: "ok",
          crawl_pages: String(result.pages),
          crawl_emails: joinList(result.emails),
          crawl_phones: joinList(result.phones),
          screenshot_path: result.screenshotPath,
        });
        await this.store.flush();
        this.emit({
          type: "item",
          key,
          name: listing.name ?? "",
          stage: "crawl",
          status: "ok",
          detail: `${result.pages} pages, ${result.emails.length} emails`,
        });

        // 2a. Schedule AI immediately — Mistral queue is the bottleneck,
        // we want it busy as soon as a screenshot exists.
        if (!this.opts.skipAi) this.scheduleAi(key, listing, result.screenshotPath);

        // 2b. Schedule Lighthouse in parallel.
        if (!this.opts.skipLighthouse) this.scheduleLighthouse(key, listing);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.store.upsert(key, {
          crawl_status: "error",
          lighthouse_status: "skipped",
          ai_status: "skipped",
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

  private scheduleLighthouse(key: string, listing: ScrapedListing) {
    const website = listing.website;
    if (!website) return;
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
        const scores = await runLighthouse(
          website,
          this.opts.lighthouseDir,
          key,
        );
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
        this.store.upsert(key, {
          lighthouse_status: "error",
          error: msg,
        });
        await this.store.flush();
        this.emit({
          type: "item",
          key,
          name: listing.name ?? "",
          stage: "lighthouse",
          status: "error",
          detail: msg,
        });
      }
    });
  }

  private scheduleAi(
    key: string,
    listing: ScrapedListing,
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
        // Pull a small text excerpt from the crawled HTML for grounding.
        const rec = this.store.get(key);
        const htmlPath = join(
          this.opts.crawlsDir,
          `${key.replace(/[^a-zA-Z0-9._-]+/g, "_")}.html`,
        );
        let contextText = "";
        try {
          contextText = readFileSync(htmlPath, "utf8")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ");
        } catch {
          contextText = rec?.name ?? "";
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
      }
    });
  }
}
