import { readFileSync } from "node:fs";
import { mistral } from "@ai-sdk/mistral";
import { generateObject } from "ai";
import { z } from "zod";

// AI assessment uses ai-sdk with the Mistral provider. The default model
// is pixtral-large-latest because it's vision-capable; mistral-large-latest
// would reject the image attachment. The assessment is structured: design
// and quality scores 1-10 plus a feature inventory.
//
// IMPORTANT: callers MUST serialize calls to this function — Mistral
// allows only 1 in-flight request on the free tier. The orchestrator wraps
// every call in a concurrency=1 Queue.

const Assessment = z.object({
  design_score: z.number().min(1).max(10),
  quality_score: z.number().min(1).max(10),
  features: z.array(z.string()),
  summary: z.string(),
});

export type Assessment = z.infer<typeof Assessment>;

const PROMPT = `You are a senior web designer auditing a small-business website
on behalf of a sales team. Look at the homepage screenshot and the visible
text content and produce a strict structured assessment:

- design_score (1-10): overall visual design quality. 1 = looks like a 2005
  template, 10 = polished modern brand site.
- quality_score (1-10): perceived professional quality and trustworthiness,
  factoring in typography, content density, imagery quality, and layout.
- features: short tags for capabilities you can detect on the page
  (examples: "online_ordering", "booking", "contact_form", "blog",
  "ecommerce", "newsletter", "live_chat", "menu", "gallery", "testimonials",
  "social_links", "map_embed", "phone_click_to_call").
- summary: 1-2 sentences describing what this site is and what it could
  most benefit from in a redesign.

Be honest. Most small business sites score 3-6.`;

export interface AssessOptions {
  screenshotPath: string;
  contextText?: string;
  model?: string;
}

export async function assessSite(opts: AssessOptions): Promise<Assessment> {
  const modelName = opts.model ?? "pixtral-large-latest";
  const image = readFileSync(opts.screenshotPath);

  const { object } = await generateObject({
    model: mistral(modelName),
    schema: Assessment,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: PROMPT },
          {
            type: "text",
            text: `Visible page text (truncated):\n${(opts.contextText ?? "").slice(0, 4000)}`,
          },
          { type: "image", image },
        ],
      },
    ],
  });

  return object;
}
