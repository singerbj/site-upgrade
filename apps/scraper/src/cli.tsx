#!/usr/bin/env -S npx tsx
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { useEffect, useState } from "react";
import { Box, render, Text, useApp } from "ink";
import Spinner from "ink-spinner";
import { type PhaseEvent, Pipeline } from "./pipeline.ts";
import type { QueueStats } from "./queue.ts";

// CLI surface
//   scraper --query="dentists in Austin TX" [--places=40] [--headful]
//          [--apex=example.com] [--no-lighthouse] [--no-ai]
//          [--no-generation] [--no-evaluation]
//          [--gen-concurrency=1] [--model=pixtral-large-latest]
//          [--csv=path] [--claude-bin=claude]
//
// `--places` is the primary flag for "how many businesses to pull from
// Google Maps"; `--max` is kept as a back-compat alias.

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.length ? v.join("=") : "true"];
  }));

if (!args.query || args.query === "true") {
  console.error(
    'Usage: scraper --query="dentists in Austin TX" [--places=40] [--apex=example.com]\n' +
      "         [--headful] [--no-lighthouse] [--no-ai] [--no-generation] [--no-evaluation]\n" +
      "         [--gen-concurrency=1] [--model=pixtral-large-latest] [--csv=path] [--claude-bin=claude]",
  );
  process.exit(1);
}

function intOrUndef(v: string | undefined): number | undefined {
  if (!v || v === "true") return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, "..");
const REPO_ROOT = resolve(PKG_ROOT, "..", "..");
const dataDir = resolve(PKG_ROOT, "data");
const csvPath = args.csv
  ? resolve(args.csv)
  : resolve(dataDir, "businesses.csv");

const opts = {
  query: args.query,
  // --places is the canonical name; --max is kept as an alias.
  maxResults: intOrUndef(args.places) ?? intOrUndef(args.max) ?? 40,
  csvPath,
  repoRoot: REPO_ROOT,
  apex: args.apex && args.apex !== "true" ? args.apex : "example.com",
  headful: args.headful === "true",
  skipLighthouse: args["no-lighthouse"] === "true",
  skipAi: args["no-ai"] === "true",
  skipGeneration: args["no-generation"] === "true",
  skipEvaluation: args["no-evaluation"] === "true",
  generateConcurrency: intOrUndef(args["gen-concurrency"]) ?? 1,
  aiModel: args.model,
  claudeBin: args["claude-bin"],
};

interface RecentEntry {
  id: number;
  stage: string;
  name: string;
  status: string;
  detail?: string;
}
interface ErrorEntry {
  id: number;
  message: string;
}
interface State {
  mapsStatus: "idle" | "scraping" | "done";
  scrolled: number;
  total: number;
  newRows: number;
  crawl: QueueStats;
  lighthouse: QueueStats;
  ai: QueueStats;
  generate: QueueStats;
  evaluate: QueueStats;
  recent: RecentEntry[];
  errors: ErrorEntry[];
  finished: boolean;
  summary?: { total: number; new: number; processed: number };
}

let nextEntryId = 0;

const initialQ: QueueStats = { size: 0, active: 0, done: 0, errors: 0 };

function App() {
  const { exit } = useApp();
  const [state, setState] = useState<State>({
    mapsStatus: "idle",
    scrolled: 0,
    total: 0,
    newRows: 0,
    crawl: initialQ,
    lighthouse: initialQ,
    ai: initialQ,
    generate: initialQ,
    evaluate: initialQ,
    recent: [],
    errors: [],
    finished: false,
  });

  useEffect(() => {
    const pipeline = new Pipeline(opts);
    pipeline.on((e: PhaseEvent) => {
      setState((s) => {
        const next = { ...s };
        switch (e.type) {
          case "phase":
            if (e.phase === "maps") {
              next.mapsStatus = e.status === "start" ? "scraping" : "done";
            }
            break;
          case "scrolled":
            next.scrolled = e.count;
            break;
          case "listing":
            next.total = e.total;
            next.newRows = e.new;
            break;
          case "queues":
            next.crawl = e.crawl;
            next.lighthouse = e.lighthouse;
            next.ai = e.ai;
            next.generate = e.generate;
            next.evaluate = e.evaluate;
            break;
          case "item": {
            const head: RecentEntry = {
              id: ++nextEntryId,
              stage: e.stage,
              name: e.name,
              status: e.status,
              detail: e.detail,
            };
            next.recent = [head, ...s.recent].slice(0, 12);
            if (e.status === "error") {
              next.errors = [
                {
                  id: ++nextEntryId,
                  message: `${e.stage}:${e.name}: ${e.detail ?? ""}`,
                },
                ...s.errors,
              ].slice(0, 5);
            }
            break;
          }
          case "log":
            if (e.level === "error") {
              next.errors = [
                { id: ++nextEntryId, message: e.message },
                ...s.errors,
              ].slice(0, 5);
            }
            break;
          case "summary":
            next.summary = e;
            next.finished = true;
            break;
        }
        return next;
      });
    });

    let runError: Error | undefined;
    pipeline
      .run()
      .catch((err) => {
        runError = err instanceof Error ? err : new Error(String(err));
        setState((s) => ({
          ...s,
          errors: [
            { id: ++nextEntryId, message: String(err?.message ?? err) },
            ...s.errors,
          ],
          finished: true,
        }));
      })
      .finally(() => {
        // Small delay so the final frame renders before unmount. Passing
        // the Error to exit() makes Ink set the process exit code.
        setTimeout(() => exit(runError), 50);
      });
  }, []);

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>site-upgrade scraper</Text>
        <Text> query: </Text>
        <Text color="cyan">{opts.query}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text bold>Phase 1 — Google Maps</Text>
        <Box>
          <Text> status: </Text>
          {state.mapsStatus === "scraping" ? (
            <>
              <Spinner type="dots" />
              <Text> scraping</Text>
            </>
          ) : (
            <Text color={state.mapsStatus === "done" ? "green" : "gray"}>
              {state.mapsStatus}
            </Text>
          )}
        </Box>
        <Text>
          {"  "}scrolled: {state.scrolled} | listings seen: {state.total} | new
          this run: {state.newRows}
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text bold>Phase 2 — Pipelines</Text>
        <QueueLine label="crawl     " stats={state.crawl} />
        <QueueLine label="lighthouse" stats={state.lighthouse} />
        <QueueLine label="mistral AI" stats={state.ai} />
        <QueueLine label="generate  " stats={state.generate} />
        <QueueLine label="evaluate  " stats={state.evaluate} />
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text bold>Recent activity</Text>
        {state.recent.length === 0 ? (
          <Text color="gray"> (waiting…)</Text>
        ) : (
          state.recent.map((r) => (
            <Text key={r.id}>
              {"  "}
              <Text color={statusColor(r.status)}>{padRight(r.status, 5)}</Text>{" "}
              <Text color="magenta">{padRight(r.stage, 10)}</Text>{" "}
              <Text>{padRight(r.name, 32)}</Text>{" "}
              <Text color="gray">{r.detail ?? ""}</Text>
            </Text>
          ))
        )}
      </Box>
      {state.errors.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text bold color="red">
            Errors
          </Text>
          {state.errors.map((er) => (
            <Text key={er.id} color="red">
              {"  "}
              {er.message}
            </Text>
          ))}
        </Box>
      )}
      {state.summary && (
        <Box marginTop={1} flexDirection="column">
          <Text bold color="green">
            Done
          </Text>
          <Text>
            {"  "}rows in CSV: {state.summary.total} | new this run:{" "}
            {state.summary.new} | processed: {state.summary.processed}
          </Text>
          <Text color="gray"> csv: {opts.csvPath}</Text>
        </Box>
      )}
    </Box>
  );
}

function QueueLine({ label, stats }: { label: string; stats: QueueStats }) {
  return (
    <Text>
      {"  "}
      <Text color="cyan">{label}</Text>
      {"  "}active=<Text color="yellow">{stats.active}</Text> pending=
      <Text color="yellow">{stats.size}</Text> done=
      <Text color="green">{stats.done}</Text> errors=
      <Text color={stats.errors ? "red" : "gray"}>{stats.errors}</Text>
    </Text>
  );
}

function statusColor(s: string): string {
  if (s === "ok") return "green";
  if (s === "error") return "red";
  if (s === "start") return "yellow";
  if (s === "skip") return "gray";
  return "white";
}

function padRight(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n);
  return s + " ".repeat(n - s.length);
}

render(<App />);
