import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { type BusinessRecord, FIELDS, emptyRecord } from "./types.ts";

// CSV parsing/writing tuned to our schema. Keeps the on-disk file as the
// dedup ledger: load it on start, mutate in-memory, flush back atomically.
// All flushes are serialized through a tail-promise so concurrent writers
// can't interleave.

function escape(v: string): string {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function parseLine(line: string): string[] {
  const out: string[] = [];
  let i = 0;
  let cur = "";
  let inQuotes = false;
  while (i < line.length) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cur += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      out.push(cur);
      cur = "";
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  out.push(cur);
  return out;
}

function parseCsv(text: string): BusinessRecord[] {
  // Split on row boundaries while respecting quoted newlines.
  const rows: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQuotes && text[i + 1] === '"') {
        cur += '""';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      cur += c;
      continue;
    }
    if ((c === "\n" || c === "\r") && !inQuotes) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      if (cur.length) rows.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.length) rows.push(cur);

  if (rows.length === 0) return [];
  const header = parseLine(rows[0]);
  const records: BusinessRecord[] = [];
  const fieldSet = new Set<string>(FIELDS);
  for (let r = 1; r < rows.length; r++) {
    const cells = parseLine(rows[r]);
    const rec = emptyRecord() as unknown as Record<string, string>;
    for (let c = 0; c < header.length; c++) {
      const key = header[c];
      if (fieldSet.has(key)) rec[key] = cells[c] ?? "";
    }
    records.push(rec as unknown as BusinessRecord);
  }
  return records;
}

function serialize(records: BusinessRecord[]): string {
  const lines = [FIELDS.join(",")];
  for (const r of records) {
    lines.push(FIELDS.map((f) => escape(r[f] ?? "")).join(","));
  }
  return lines.join("\n") + "\n";
}

export class CsvStore {
  private path: string;
  // Map keyed by dedup id (place_id, falling back to a normalized
  // name|address|website triple for entries lacking a place_id).
  private byKey = new Map<string, BusinessRecord>();
  private order: string[] = [];
  private flushChain: Promise<void> = Promise.resolve();
  private dirty = false;
  private onError?: (err: unknown) => void;

  constructor(path: string, onError?: (err: unknown) => void) {
    this.path = path;
    this.onError = onError;
    if (existsSync(path)) {
      const text = readFileSync(path, "utf8");
      const records = parseCsv(text);
      for (const r of records) {
        const key = dedupKey(r);
        if (!this.byKey.has(key)) {
          this.byKey.set(key, r);
          this.order.push(key);
        }
      }
    } else {
      mkdirSync(dirname(path), { recursive: true });
    }
  }

  has(key: string): boolean {
    return this.byKey.has(key);
  }

  get(key: string): BusinessRecord | undefined {
    return this.byKey.get(key);
  }

  upsert(key: string, patch: Partial<BusinessRecord>): BusinessRecord {
    const existing = this.byKey.get(key);
    if (existing) {
      Object.assign(existing, patch);
      this.dirty = true;
      return existing;
    }
    const rec = { ...emptyRecord(), ...patch };
    this.byKey.set(key, rec);
    this.order.push(key);
    this.dirty = true;
    return rec;
  }

  count(): number {
    return this.byKey.size;
  }

  // Atomic write: serialize to a sibling tmp, then rename. Errors are
  // swallowed (and reported via onError) so a single bad write doesn't
  // poison the chain — the next flush still runs.
  flush(): Promise<void> {
    this.flushChain = this.flushChain.then(async () => {
      if (!this.dirty) return;
      this.dirty = false;
      try {
        const records = this.order
          .map((k) => this.byKey.get(k))
          .filter((r): r is BusinessRecord => Boolean(r));
        const text = serialize(records);
        const tmp = `${this.path}.tmp`;
        writeFileSync(tmp, text, "utf8");
        renameSync(tmp, this.path);
      } catch (err) {
        // Mark dirty again so the next flush retries.
        this.dirty = true;
        if (this.onError) this.onError(err);
      }
    });
    return this.flushChain;
  }
}

export function dedupKey(r: Partial<BusinessRecord>): string {
  if (r.place_id) return `pid:${r.place_id}`;
  const norm = (s: string | undefined) =>
    (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  return `nai:${norm(r.name)}|${norm(r.address)}|${norm(r.website)}`;
}
