import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { SeoSnapshot } from "./seo-snapshot.ts";
import type { BusinessRecord } from "./types.ts";

// Brand kit — a stable, versioned JSON document that captures
// everything we know about a business's brand. It's:
//   - the source of truth Claude Code reads during generation,
//   - the file the standalone /brand-kit.html viewer renders, and
//   - committed under sites/<slug>/.assets/brand-kit.json so it's
//     auditable per business.
//
// The schema is versioned so we can evolve it without breaking
// downstream consumers. Today there's only one version; future
// migrations should carry the previous shape under a discriminated
// union and convert on read.

const BRAND_KIT_VERSION = "1" as const;

const PaletteEntry = z.object({
  hex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  role: z.enum([
    "primary",
    "secondary",
    "accent",
    "background",
    "text",
    "other",
  ]),
});

const FontStack = z.object({
  family: z.string(),
  fallbacks: z.array(z.string()),
});

const Logo = z.object({
  path: z.string(),
  hint: z.string(),
  primary: z.boolean(),
});

const BrandKit = z.object({
  $schema: z.literal("https://site-upgrade/brand-kit.schema.json"),
  version: z.literal(BRAND_KIT_VERSION),
  business: z.object({
    name: z.string(),
    slug: z.string(),
    hostname: z.string(),
    tagline: z.string(),
    category: z.string(),
    address: z.string(),
    phone: z.string(),
    emails: z.array(z.string()),
    website: z.string(),
    hours: z.string(),
    geo: z.object({ lat: z.string(), lng: z.string() }),
  }),
  identity: z.object({
    summary: z.string(),
    voice: z.array(z.string()),
    audience: z.string(),
  }),
  colors: z.object({
    palette: z.array(PaletteEntry),
  }),
  typography: z.object({
    heading: FontStack,
    body: FontStack,
  }),
  logos: z.array(Logo),
  copy: z.object({
    headlines: z.array(z.string()),
    summary: z.string(),
  }),
  features: z.array(z.string()),
  sources: z.object({
    captured_from: z.string(),
    captured_at: z.string(),
    screenshot: z.string(),
    seo_snapshot: z.string(),
    copy: z.string(),
  }),
});

export type BrandKit = z.infer<typeof BrandKit>;
export type Palette = BrandKit["colors"]["palette"];
export const BrandKitSchema = BrandKit;
export const BRAND_KIT_FILENAME = "brand-kit.json";
export const BRAND_KIT_VIEWER_FILENAME = "brand-kit.html";

// ---------------------------------------------------------------------------
// Invented logo (SVG)
// ---------------------------------------------------------------------------
//
// When a business has no existing site, the pipeline still needs a
// visual mark. We render a deterministic monogram + wordmark SVG from
// the AI-invented palette and initials. SVG so it scales freely and
// downstream Claude Code can recolor or restyle it.

const FALLBACK_PALETTE = {
  primary: "#1f2937",
  background: "#ffffff",
  text: "#111827",
  accent: "#6366f1",
};

function pickColor(palette: Palette, role: string, fallback: string): string {
  return palette.find((p) => p.role === role)?.hex ?? fallback;
}

// Best-effort luminance check so we pair the monogram letter with a
// readable foreground color. Inputs are 6-digit hex like "#aabbcc".
function isDark(hex: string): boolean {
  const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return true;
  const [r, g, b] = [
    Number.parseInt(m[1], 16),
    Number.parseInt(m[2], 16),
    Number.parseInt(m[3], 16),
  ];
  // Rec. 709 luma.
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum < 140;
}

function escapeXml(s: string): string {
  return s.replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c] ?? c,
  );
}

function deriveInitials(name: string): string {
  const tokens = (name || "")
    .replace(/[^a-zA-Z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((t) => t && !/^(the|of|and|&|for|a|an|to)$/i.test(t));
  if (tokens.length === 0) return "?";
  if (tokens.length === 1) return tokens[0].slice(0, 2).toUpperCase();
  return (tokens[0][0] + tokens[1][0]).toUpperCase();
}

export interface InventedLogoArgs {
  name: string;
  initials?: string;
  palette: Palette;
}

// Monogram badge + horizontal wordmark. Single SVG, no external refs,
// system-ui font (browsers and most viewers handle it). About 1.2KB.
export function buildInventedSvgLogo(args: InventedLogoArgs): string {
  const { name } = args;
  const initials = (args.initials || deriveInitials(name))
    .toUpperCase()
    .slice(0, 3);
  const palette = args.palette;

  const primary = pickColor(palette, "primary", FALLBACK_PALETTE.primary);
  const background = pickColor(
    palette,
    "background",
    FALLBACK_PALETTE.background,
  );
  const text = pickColor(palette, "text", FALLBACK_PALETTE.text);
  const accent = pickColor(palette, "accent", FALLBACK_PALETTE.accent);

  // Monogram fg should contrast the badge bg (primary). If primary is
  // dark use background as the letter color; otherwise use text.
  const monoFg = isDark(primary) ? background : text;

  // Width scales with name length so the wordmark doesn't overflow.
  const safeName = (name || "").trim() || "Untitled";
  const wordmarkLen = safeName.length;
  const wordmarkWidth = Math.max(140, Math.min(360, 12 + wordmarkLen * 11));
  const totalWidth = 80 + wordmarkWidth;
  const totalHeight = 80;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${totalHeight}" width="${totalWidth}" height="${totalHeight}" role="img" aria-label="${escapeXml(safeName)} logo">
  <title>${escapeXml(safeName)}</title>
  <rect x="0" y="0" width="${totalWidth}" height="${totalHeight}" rx="12" fill="${background}"/>
  <rect x="8" y="8" width="64" height="64" rx="14" fill="${primary}"/>
  <rect x="8" y="60" width="64" height="3" rx="1.5" fill="${accent}" opacity="0.85"/>
  <text x="40" y="52" text-anchor="middle" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-size="${
    initials.length >= 3 ? 22 : 28
  }" font-weight="700" fill="${monoFg}" letter-spacing="-0.02em">${escapeXml(initials)}</text>
  <text x="84" y="50" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-size="22" font-weight="600" fill="${text}" letter-spacing="-0.01em">${escapeXml(safeName)}</text>
</svg>
`;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export interface BuildBrandKitArgs {
  rec: BusinessRecord;
  snapshot: SeoSnapshot | null;
  // Logo paths absolute on disk — turned into relative entries inside
  // the kit so the viewer can resolve them without knowing the repo
  // root.
  logoAbsPaths: string[];
  siteDir: string;
}

export function buildBrandKit(args: BuildBrandKitArgs): BrandKit {
  const { rec, snapshot, logoAbsPaths, siteDir } = args;

  const palette = parsePalette(rec.brand_palette);
  const voice = splitList(rec.brand_voice);
  const features = splitList(rec.ai_features);
  const emails = splitList(rec.crawl_emails);

  const fontStack = (raw: string) => {
    const families = (raw || "")
      .split(",")
      .map((f) => f.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
    return {
      family: families[0] ?? "system-ui",
      fallbacks: families.slice(1),
    };
  };

  const headlines = snapshot
    ? [...snapshot.h1s, ...snapshot.h2s.slice(0, 4)].filter(Boolean)
    : [];

  const logos = logoAbsPaths.map((abs, i) => ({
    path: relative(siteDir, abs),
    hint: hintFromFilename(abs),
    primary: i === 0,
  }));

  const sources = {
    captured_from: rec.website,
    captured_at: rec.scraped_at,
    screenshot: relativeOrEmpty(rec.screenshot_path, siteDir),
    seo_snapshot: relativeOrEmpty(rec.seo_snapshot_path, siteDir),
    copy: relativeOrEmpty(rec.copy_path, siteDir),
  };

  const kit: BrandKit = {
    $schema: "https://site-upgrade/brand-kit.schema.json",
    version: BRAND_KIT_VERSION,
    business: {
      name: rec.name,
      slug: rec.site_slug,
      hostname: rec.site_hostname,
      tagline: rec.brand_tagline,
      category: rec.category,
      address: rec.address,
      phone: rec.phone,
      emails,
      website: rec.website,
      hours: rec.hours,
      geo: { lat: rec.latitude, lng: rec.longitude },
    },
    identity: {
      summary: rec.ai_summary,
      voice,
      audience: rec.category, // best proxy we have without another AI call
    },
    colors: { palette },
    typography: {
      heading: fontStack(snapshot?.fonts.heading ?? ""),
      body: fontStack(snapshot?.fonts.body ?? ""),
    },
    logos,
    copy: {
      headlines,
      summary: rec.ai_summary,
    },
    features,
    sources,
  };

  // Validate before returning so downstream consumers (Claude Code,
  // the viewer) can rely on the shape. Throws on invalid input.
  return BrandKit.parse(kit);
}

export function writeBrandKit(kit: BrandKit, path: string): void {
  writeFileSync(path, JSON.stringify(kit, null, 2), "utf8");
}

// ---------------------------------------------------------------------------
// Viewer install (post-build)
// ---------------------------------------------------------------------------
//
// The viewer is a self-contained vanilla HTML page shipped from
// templates/. Same tamper-proof pattern as the comparison overlay —
// post-processed into dist/ so it's not at the mercy of whatever
// React tree Claude Code wrote.

const HERE_FILE = fileURLToPath(import.meta.url);
const TEMPLATES_DIR = resolve(HERE_FILE, "..", "..", "templates");
const VIEWER_TEMPLATE = resolve(TEMPLATES_DIR, "brand-kit.html");

export interface InstallBrandKitArgs {
  distDir: string;
  kit: BrandKit;
  // Logos are referenced by relative path inside the kit. The viewer
  // is served from /brand-kit.html so we copy logos to /assets/logos/
  // in dist so the relative paths resolve.
  logoAbsPaths: string[];
}

export interface InstallBrandKitResult {
  kitPath: string;
  viewerPath: string;
}

export function installBrandKit(
  args: InstallBrandKitArgs,
): InstallBrandKitResult {
  const { distDir, kit, logoAbsPaths } = args;
  if (!existsSync(distDir)) {
    throw new Error(`dist not found: ${distDir}`);
  }

  // Copy logos into dist/assets/logos/ and rewrite kit logo paths to
  // /assets/logos/<basename>. This way the viewer at /brand-kit.html
  // can render them without poking around above the web root.
  const distLogosDir = join(distDir, "assets", "logos");
  mkdirSync(distLogosDir, { recursive: true });

  const rewrittenLogos = logoAbsPaths.map((abs, i) => {
    const dst = join(distLogosDir, basename(abs));
    try {
      copyFileSync(abs, dst);
    } catch {
      // skip logos we couldn't copy (missing source)
    }
    return {
      path: `/assets/logos/${basename(abs)}`,
      hint: hintFromFilename(abs),
      primary: i === 0,
    };
  });
  const publishedKit: BrandKit = { ...kit, logos: rewrittenLogos };

  const kitPath = join(distDir, BRAND_KIT_FILENAME);
  writeFileSync(kitPath, JSON.stringify(publishedKit, null, 2), "utf8");

  const viewerPath = join(distDir, BRAND_KIT_VIEWER_FILENAME);
  copyFileSync(VIEWER_TEMPLATE, viewerPath);

  return { kitPath, viewerPath };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function splitList(s: string): string[] {
  return (s || "")
    .split(";")
    .map((x) => x.trim())
    .filter(Boolean);
}

// brand_palette is stored in the CSV as "#hex:role; #hex:role; ...".
// Tolerate both forms — the AI returns objects but we serialize compactly.
function parsePalette(
  raw: string,
): { hex: string; role: BrandKit["colors"]["palette"][number]["role"] }[] {
  if (!raw) return [];
  const out: {
    hex: string;
    role: BrandKit["colors"]["palette"][number]["role"];
  }[] = [];
  for (const part of raw.split(";")) {
    const [hex, role] = part.split(":").map((x) => x.trim());
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) continue;
    const r = (role ??
      "other") as BrandKit["colors"]["palette"][number]["role"];
    const valid = [
      "primary",
      "secondary",
      "accent",
      "background",
      "text",
      "other",
    ] as const;
    out.push({
      hex: hex.toLowerCase(),
      role: (valid as readonly string[]).includes(r) ? r : "other",
    });
  }
  return out;
}

export function paletteToCsv(palette: { hex: string; role: string }[]): string {
  return palette.map((p) => `${p.hex}:${p.role}`).join("; ");
}

function hintFromFilename(p: string): string {
  // Logos are saved as "<index>-<hint>.<ext>" by crawl.ts.
  const m = basename(p).match(/^\d+-([^.]+)\./);
  return m?.[1] ?? "logo";
}

function relativeOrEmpty(p: string, root: string): string {
  if (!p) return "";
  // Paths in the CSV are relative-to-repo-root. Convert to relative-
  // to-siteDir for inclusion in the kit (which lives under siteDir).
  const abs = resolve(root, "..", "..", p);
  return relative(root, abs);
}
