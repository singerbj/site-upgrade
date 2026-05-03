export interface Env {
  SITES: R2Bucket;
}

const HTML_TYPES = new Set(["text/html", "application/xhtml+xml"]);

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    const host = (request.headers.get("host") ?? "").toLowerCase();

    if (!host) return new Response("Missing host", { status: 400 });
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405 });
    }

    const cache = caches.default;
    const cacheKey = new Request(url.toString(), request);
    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    const path = url.pathname.endsWith("/")
      ? `${url.pathname}index.html`
      : url.pathname;
    const key = `${host}${path}`;

    let object = await env.SITES.get(key);

    // Pretty-URL fallback: try `${path}.html`
    if (!object && !path.includes(".")) {
      object = await env.SITES.get(`${host}${path}.html`);
    }
    // SPA fallback: serve index.html for unknown routes that don't look like assets
    if (!object && !path.includes(".")) {
      object = await env.SITES.get(`${host}/index.html`);
    }
    if (!object) {
      return new Response("Not found", { status: 404 });
    }

    const contentType =
      object.httpMetadata?.contentType ?? guessContentType(path);
    const isHtml = HTML_TYPES.has(contentType.split(";")[0]);

    const headers = new Headers();
    headers.set("content-type", contentType);
    headers.set("etag", object.httpEtag);
    headers.set(
      "cache-control",
      isHtml
        ? "public, max-age=60, s-maxage=300"
        : "public, max-age=31536000, immutable",
    );
    headers.set("x-content-type-options", "nosniff");
    headers.set("referrer-policy", "strict-origin-when-cross-origin");

    const response = new Response(object.body, { headers });

    if (!isHtml) {
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
    }

    return response;
  },
} satisfies ExportedHandler<Env>;

function guessContentType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    html: "text/html; charset=utf-8",
    htm: "text/html; charset=utf-8",
    css: "text/css; charset=utf-8",
    js: "application/javascript; charset=utf-8",
    mjs: "application/javascript; charset=utf-8",
    json: "application/json; charset=utf-8",
    svg: "image/svg+xml",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    avif: "image/avif",
    gif: "image/gif",
    ico: "image/x-icon",
    woff: "font/woff",
    woff2: "font/woff2",
    ttf: "font/ttf",
    txt: "text/plain; charset=utf-8",
    xml: "application/xml",
    pdf: "application/pdf",
    map: "application/json",
  };
  return map[ext] ?? "application/octet-stream";
}
