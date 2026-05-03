import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as ChromeLauncher from "chrome-launcher";
import lighthouse from "lighthouse";
import { safeFilename } from "./util.ts";

export interface LighthouseScores {
  performance: number;
  accessibility: number;
  bestPractices: number;
  seo: number;
  reportPath: string;
}

// Boots a fresh headless Chrome per-run so Lighthouse can use a clean
// profile (its measurements are sensitive to extensions / cached state).
// We keep this serialized to avoid Chrome processes fighting for CPU on
// the same box; the orchestrator wraps this in a Queue.
export async function runLighthouse(
  url: string,
  outDir: string,
  key: string,
): Promise<LighthouseScores> {
  mkdirSync(outDir, { recursive: true });

  const chrome = await ChromeLauncher.launch({
    chromeFlags: [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
    ],
  });

  try {
    const result = await lighthouse(
      url,
      {
        port: chrome.port,
        output: "json",
        logLevel: "error",
        onlyCategories: [
          "performance",
          "accessibility",
          "best-practices",
          "seo",
        ],
      },
      undefined,
    );

    if (!result) throw new Error("Lighthouse returned no result");

    const lhr = result.lhr;
    const reportPath = join(outDir, `${safeFilename(key)}.json`);
    writeFileSync(reportPath, JSON.stringify(lhr, null, 2), "utf8");

    const cat = (id: string) => Math.round(((lhr.categories as Record<string, { score: number | null }>)[id]?.score ?? 0) * 100);

    return {
      performance: cat("performance"),
      accessibility: cat("accessibility"),
      bestPractices: cat("best-practices"),
      seo: cat("seo"),
      reportPath,
    };
  } finally {
    await chrome.kill().catch(() => {});
  }
}
