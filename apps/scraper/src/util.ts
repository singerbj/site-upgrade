// Shared regex/normalization helpers.

import { createHash } from "node:crypto";

const EMAIL_RE = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,24})/g;

// Phone matching is intentionally permissive — we collect everything that
// looks plausible, then filter by digit count. The site itself is the
// source of truth for what's a real number.
const PHONE_RE =
  /(\+?\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{2,4}[\s.-]?\d{2,4}(?:[\s.-]?\d{1,4})?/g;

export function uniq<T>(xs: Iterable<T>): T[] {
  return [...new Set(xs)];
}

export function extractEmails(text: string): string[] {
  const matches = text.match(EMAIL_RE) ?? [];
  return uniq(
    matches
      .map((m) => m.toLowerCase())
      // Strip junk that often gets caught by the regex inside hashes/sentry IDs.
      .filter((m) => !m.includes("..") && m.length < 120),
  );
}

export function extractPhones(text: string): string[] {
  const matches = text.match(PHONE_RE) ?? [];
  return uniq(
    matches
      .map((m) => m.replace(/\s+/g, " ").trim())
      // 7-15 digits weeds out years, prices, postcodes, and serials.
      .filter((m) => {
        const digits = (m.match(/\d/g) ?? []).length;
        return digits >= 7 && digits <= 15;
      }),
  );
}

export function joinList(xs: string[]): string {
  return xs.join("; ");
}

export function safeFilename(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Pull a Google Maps place id out of a maps URL when present. Maps uses
// hex CIDs in `!1s0x..:0x..` segments; the second hex is the canonical id.
export function placeIdFromUrl(url: string): string {
  const m = url.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i);
  if (m) return m[1];
  const cid = url.match(/[?&]cid=(\d+)/);
  if (cid) return `cid:${cid[1]}`;
  return "";
}

export function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

// Maps' authority links are usually absolute, but occasionally come back
// as bare hostnames. Prepend https:// if the input lacks a scheme so
// downstream `new URL(...)` and `page.goto(...)` accept it.
export function normalizeUrl(url: string): string {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url.replace(/^\/+/, "")}`;
}

// Slug for sites/<slug>/. Stable per dedup key (so re-runs target the
// same directory) and unique across the dataset (hash suffix prevents
// collisions when two businesses share a name).
export function siteSlug(name: string, key: string): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 30) || "biz";
  const hash = createHash("sha1").update(key).digest("hex").slice(0, 6);
  return `${base}-${hash}`;
}

// Resolve a possibly-relative href against a page URL. Returns "" on
// invalid input rather than throwing — most callers want a best-effort
// candidate list.
export function resolveUrl(href: string, base: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return "";
  }
}
