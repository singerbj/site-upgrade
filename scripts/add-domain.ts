#!/usr/bin/env -S node --experimental-strip-types
// Provisions a Cloudflare for SaaS Custom Hostname for a customer-owned
// domain (e.g. acme.com). After this runs, point the customer at the
// CNAME target shown in the output.
//
// Usage: node --experimental-strip-types scripts/add-domain.ts --hostname=acme.com
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.join("=")];
  }));

const hostname = args.hostname;
const zoneId = process.env.CF_ZONE_ID;
const apiToken = process.env.CF_API_TOKEN;
const fallbackOrigin =
  process.env.CF_FALLBACK_ORIGIN ?? `${hostname}.cdn.example.com`;

if (!hostname) throw new Error("Missing --hostname=");
if (!zoneId || !apiToken) {
  throw new Error("Missing CF_ZONE_ID / CF_API_TOKEN env vars");
}

const res = await fetch(
  `https://api.cloudflare.com/client/v4/zones/${zoneId}/custom_hostnames`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      hostname,
      ssl: {
        method: "http",
        type: "dv",
        settings: { min_tls_version: "1.2" },
      },
    }),
  },
);

const body = (await res.json()) as {
  result?: { id: string; hostname: string; status: string };
  errors?: unknown;
};
if (!res.ok) {
  console.error(body);
  process.exit(1);
}

const result = body.result!;
console.log(`Custom hostname created: ${result.hostname}`);
console.log(`  ID: ${result.id}`);
console.log(`  Status: ${result.status}`);
console.log(`\nTell the customer to add this DNS record at their registrar:`);
console.log(`  CNAME  ${hostname}  ->  ${fallbackOrigin}`);
