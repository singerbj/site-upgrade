export type StageStatus = "pending" | "running" | "ok" | "error" | "skipped";

export interface BusinessRecord {
  // Identity
  place_id: string;
  query: string;

  // Google Maps fields
  name: string;
  address: string;
  phone: string;
  website: string;
  category: string;
  rating: string;
  reviews_count: string;
  latitude: string;
  longitude: string;
  hours: string;
  maps_url: string;
  scraped_at: string;

  // Per-business folder. Single column the CSV uses to point at every
  // artifact; everything below this line is either a file inside this
  // dir or a value derived from one.
  site_dir: string;
  site_slug: string;
  site_hostname: string;

  // Crawl (artifacts written under <site_dir>/.assets/)
  crawl_status: StageStatus | "";
  crawl_pages: string;
  crawl_emails: string;
  crawl_phones: string;
  screenshot_path: string;
  copy_path: string;
  logo_paths: string;
  seo_snapshot_path: string;

  // Lighthouse on the existing site
  lighthouse_status: StageStatus | "";
  lighthouse_performance: string;
  lighthouse_accessibility: string;
  lighthouse_best_practices: string;
  lighthouse_seo: string;

  // AI assessment of the existing site (design + quality + SEO + AEO).
  // ai_design_score / ai_quality_score are 1-10. seo_score / aeo_score
  // are 0-100 to match Lighthouse-style scales.
  ai_status: StageStatus | "";
  ai_design_score: string;
  ai_quality_score: string;
  ai_features: string;
  ai_summary: string;
  seo_score: string;
  seo_summary: string;
  aeo_score: string;
  aeo_summary: string;

  // Generation: scaffold + Claude Code -> a new React site for this business
  brief_path: string;
  generation_status: StageStatus | "";
  generation_summary: string;

  // Evaluation of the generated site (built + served locally)
  new_screenshot_path: string;
  new_lighthouse_status: StageStatus | "";
  new_lighthouse_performance: string;
  new_lighthouse_accessibility: string;
  new_lighthouse_best_practices: string;
  new_lighthouse_seo: string;
  new_ai_status: StageStatus | "";
  new_ai_design_score: string;
  new_ai_quality_score: string;
  new_ai_features: string;
  new_ai_summary: string;
  new_seo_score: string;
  new_seo_summary: string;
  new_aeo_score: string;
  new_aeo_summary: string;
  comparison_path: string;

  // Last error encountered (any stage). Per-stage status carries error
  // markers; this is just the most recent message for quick scanning.
  error: string;
}

export const FIELDS: (keyof BusinessRecord)[] = [
  "place_id",
  "query",
  "name",
  "address",
  "phone",
  "website",
  "category",
  "rating",
  "reviews_count",
  "latitude",
  "longitude",
  "hours",
  "maps_url",
  "scraped_at",
  "site_dir",
  "site_slug",
  "site_hostname",
  "crawl_status",
  "crawl_pages",
  "crawl_emails",
  "crawl_phones",
  "screenshot_path",
  "copy_path",
  "logo_paths",
  "seo_snapshot_path",
  "lighthouse_status",
  "lighthouse_performance",
  "lighthouse_accessibility",
  "lighthouse_best_practices",
  "lighthouse_seo",
  "ai_status",
  "ai_design_score",
  "ai_quality_score",
  "ai_features",
  "ai_summary",
  "seo_score",
  "seo_summary",
  "aeo_score",
  "aeo_summary",
  "brief_path",
  "generation_status",
  "generation_summary",
  "new_screenshot_path",
  "new_lighthouse_status",
  "new_lighthouse_performance",
  "new_lighthouse_accessibility",
  "new_lighthouse_best_practices",
  "new_lighthouse_seo",
  "new_ai_status",
  "new_ai_design_score",
  "new_ai_quality_score",
  "new_ai_features",
  "new_ai_summary",
  "new_seo_score",
  "new_seo_summary",
  "new_aeo_score",
  "new_aeo_summary",
  "comparison_path",
  "error",
];

export function emptyRecord(): BusinessRecord {
  return Object.fromEntries(
    FIELDS.map((f) => [f, ""]),
  ) as unknown as BusinessRecord;
}
