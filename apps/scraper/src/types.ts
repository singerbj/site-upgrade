export type Stage = "scraped" | "crawled" | "lighthouse" | "assessed" | "done";

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

  // Crawl
  crawl_status: StageStatus | "";
  crawl_pages: string;
  crawl_emails: string;
  crawl_phones: string;
  screenshot_path: string;

  // Lighthouse
  lighthouse_status: StageStatus | "";
  lighthouse_performance: string;
  lighthouse_accessibility: string;
  lighthouse_best_practices: string;
  lighthouse_seo: string;

  // AI assessment
  ai_status: StageStatus | "";
  ai_design_score: string;
  ai_quality_score: string;
  ai_features: string;
  ai_summary: string;

  // Top-level error capture (last error encountered)
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
  "crawl_status",
  "crawl_pages",
  "crawl_emails",
  "crawl_phones",
  "screenshot_path",
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
  "error",
];

export function emptyRecord(): BusinessRecord {
  return Object.fromEntries(FIELDS.map((f) => [f, ""])) as BusinessRecord;
}
