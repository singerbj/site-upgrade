import { readFileSync } from "node:fs";
import { mistral } from "@ai-sdk/mistral";
import { generateObject } from "ai";
import { z } from "zod";

// AI assessment uses ai-sdk with the Mistral provider. The default model
// is pixtral-large-latest because it's vision-capable; mistral-large-latest
// would reject the image attachment.
//
// One call returns design + quality + SEO + AEO so we don't burn extra
// trips through the strict 1-in-flight Mistral queue. Design and quality
// are 1-10; SEO and AEO are 0-100 to match Lighthouse-style scales.
//
// IMPORTANT: callers MUST serialize calls to this function — Mistral
// allows only 1 in-flight request on the free tier. The orchestrator
// wraps every call in a concurrency=1 Queue.

const Assessment = z.object({
  design_score: z.number().min(1).max(10),
  quality_score: z.number().min(1).max(10),
  features: z.array(z.string()),
  summary: z.string(),
  seo_score: z.number().min(0).max(100),
  seo_summary: z.string(),
  aeo_score: z.number().min(0).max(100),
  aeo_summary: z.string(),
});

export type Assessment = z.infer<typeof Assessment>;

const PROMPT = `You are a senior web auditor scoring a small-business
website on behalf of a sales team. You receive a homepage screenshot,
the visible page text, and a structured SEO snapshot (head metadata,
heading hierarchy, JSON-LD types, alt-text coverage, link counts).
Produce a strict structured assessment.

## Design + content (1-10)

- design_score: overall visual design quality. 1 = looks like a 2005
  template, 10 = polished modern brand site.
- quality_score: perceived professional quality and trustworthiness,
  factoring typography, content density, imagery quality, layout.
- features: short tags for capabilities you can detect on the page
  ("online_ordering", "booking", "contact_form", "blog", "ecommerce",
  "newsletter", "live_chat", "menu", "gallery", "testimonials",
  "social_links", "map_embed", "phone_click_to_call").
- summary: 1-2 sentences describing what this site is and what it
  could most benefit from in a redesign.

## SEO score (0-100)

Score traditional search-engine optimization. Consider all of:
- title tag presence, length (50-60 chars sweet spot), and specificity
- meta description presence, length (~150 chars), and quality
- single, descriptive H1; sensible H2 outline
- canonical link presence
- viewport meta + mobile-friendliness implied by the screenshot
- HTTPS
- structured data (JSON-LD) presence and relevance — LocalBusiness,
  Organization, Product, etc. are wins
- Open Graph + Twitter card completeness
- alt-text coverage on images
- internal link density
- HTTPS and clean robots/canonical

A pristine local-business site scores 85-95. A bare WordPress install
scores 40-60. A broken / incomplete site scores 10-30.

- seo_summary: 1-2 sentences describing the SEO state and the single
  biggest gap to close.

## AEO score (0-100) — Answer Engine Optimization

Score how well an LLM-driven search (Perplexity, ChatGPT, Google AI
Overviews) could extract a useful, citable answer about this business
from this page. Consider:
- crisp factual statements ("we serve X cuisine in Y neighborhood")
  rather than marketing fluff
- explicit Q&A or FAQ blocks (FAQPage schema is a strong signal)
- semantic HTML (proper headings, lists, definitions)
- structured data (LocalBusiness, FAQPage, HowTo, Product, Service)
- a clear About paragraph that states what the business is
- contact info that's easy to extract (mailto:/tel: links, NAP
  consistency)
- avoidance of all-image-no-text "designer" pages that LLMs can't read

Most small business sites score 25-55 — they lack structured Q&A and
explicit fact statements.

- aeo_summary: 1-2 sentences describing AEO state and biggest gap.

Be honest. Most small business sites score 3-6 on design/quality,
40-65 on SEO, 25-55 on AEO.`;

export interface AssessOptions {
  screenshotPath: string;
  contextText?: string;
  seoPrompt?: string;
  model?: string;
}

export async function assessSite(opts: AssessOptions): Promise<Assessment> {
  const modelName = opts.model ?? "pixtral-large-latest";
  const image = readFileSync(opts.screenshotPath);

  const userParts: Array<
    { type: "text"; text: string } | { type: "image"; image: Buffer }
  > = [{ type: "text", text: PROMPT }];

  if (opts.seoPrompt) {
    userParts.push({
      type: "text",
      text: `## Structured SEO snapshot\n${opts.seoPrompt}`,
    });
  }
  if (opts.contextText) {
    userParts.push({
      type: "text",
      text: `## Visible page text (truncated)\n${opts.contextText.slice(0, 4000)}`,
    });
  }
  userParts.push({ type: "image", image });

  const { object } = await generateObject({
    model: mistral(modelName),
    schema: Assessment,
    messages: [{ role: "user", content: userParts }],
  });

  return object;
}
