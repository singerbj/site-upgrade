#!/usr/bin/env -S npx tsx
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { useEffect, useState } from "react";
import { Box, render, Text, useApp } from "ink";
import Spinner from "ink-spinner";
import { type PhaseEvent, Pipeline } from "./pipeline.ts";
import type { QueueStats } from "./queue.ts";

// CLI surface
//   scraper --query="dentists in Austin TX" [--max=40] [--headful]
//          [--no-lighthouse] [--no-ai] [--model=mistral-large-latest]
//          [--csv=path] [--data-dir=path]

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.length ? v.join("=") : "true"];
  }),
);

if (!args.query) {
  console.error(
    "Usage: scraper --query=\"dentists in Austin TX\" [--max=40] [--headful] [--no-lighthouse] [--no-ai] [--model=mistral-large-latest]",
  );
  process.exit(1);
}

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, "..");
const dataDir = args["data-dir"]
  ? resolve(args["data-dir"])
  : resolve(PKG_ROOT, "data");
const csvPath = args.csv ? resolve(args.csv) : resolve(dataDir, "businesses.csv");

const opts = {
  query: args.query,
  maxResults: args.max ? Number.parseInt(args.max, 10) : 40,
  csvPath,
  screenshotsDir: resolve(dataDir, "screenshots"),
  crawlsDir: resolve(dataDir, "crawls"),
  lighthouseDir: resolve(dataDir, "lighthouse"),
  headful: args.headful === "true",
  skipLighthouse: args["no-lighthouse"] === "true",
  skipAi: args["no-ai"] === "true",
  aiModel: args.model,
};

interface State {
  mapsStatus: "idle" | "scraping" | "done";
  scrolled: number;
  total: number;
  newRows: number;
  crawl: QueueStats;
  lighthouse: QueueStats;
  ai: QueueStats;
  recent: { stage: string; name: string; status: string; detail?: string }[];
  errors: string[];
  finished: boolean;
  summary?: { total: number; new: number; processed: number };
}

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
            break;
          case "item": {
            const head = {
              stage: e.stage,
              name: e.name,
              status: e.status,
              detail: e.detail,
            };
            next.recent = [head, ...s.recent].slice(0, 10);
            if (e.status === "error") {
              next.errors = [
                `${e.stage}:${e.name}: ${e.detail ?? ""}`,
                ...s.errors,
              ].slice(0, 5);
            }
            break;
          }
          case "log":
            if (e.level === "error") {
              next.errors = [e.message, ...s.errors].slice(0, 5);
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

    pipeline
      .run()
      .catch((err) => {
        setState((s) => ({
          ...s,
          errors: [String(err?.message ?? err), ...s.errors],
          finished: true,
        }));
      })
      .finally(() => {
        // Tiny delay so the final frame renders before unmount.
        setTimeout(() => exit(), 50);
      });
  }, []);

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>site-upgrade scraper</Text>
        <Text>  query: </Text>
        <Text color="cyan">{opts.query}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text bold>Phase 1 — Google Maps</Text>
        <Box>
          <Text>  status: </Text>
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
          {"  "}scrolled: {state.scrolled} | listings seen: {state.total} | new this run: {state.newRows}
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text bold>Phase 2 — Pipelines</Text>
        <QueueLine label="crawl     " stats={state.crawl} />
        <QueueLine label="lighthouse" stats={state.lighthouse} />
        <QueueLine label="mistral AI" stats={state.ai} />
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text bold>Recent activity</Text>
        {state.recent.length === 0 ? (
          <Text color="gray">  (waiting…)</Text>
        ) : (
          state.recent.map((r, i) => (
            <Text key={i}>
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
          <Text bold color="red">Errors</Text>
          {state.errors.map((er, i) => (
            <Text key={i} color="red">
              {"  "}{er}
            </Text>
          ))}
        </Box>
      )}
      {state.summary && (
        <Box marginTop={1} flexDirection="column">
          <Text bold color="green">Done</Text>
          <Text>
            {"  "}rows in CSV: {state.summary.total} | new this run: {state.summary.new} | processed: {state.summary.processed}
          </Text>
          <Text color="gray">  csv: {opts.csvPath}</Text>
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
      {"  "}active=<Text color="yellow">{stats.active}</Text>{" "}
      pending=<Text color="yellow">{stats.size}</Text>{" "}
      done=<Text color="green">{stats.done}</Text>{" "}
      errors=<Text color={stats.errors ? "red" : "gray"}>{stats.errors}</Text>
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
