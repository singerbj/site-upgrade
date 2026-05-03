#!/usr/bin/env -S node --experimental-strip-types
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

// Args: --hostname=site-a.example.com --dir=./dist
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.join("=")];
  }),
);

const hostname = args.hostname;
const dir = args.dir ?? "./dist";
const bucket = process.env.R2_BUCKET ?? "sites";
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

if (!hostname) throw new Error("Missing --hostname=");
if (!accountId || !accessKeyId || !secretAccessKey) {
  throw new Error(
    "Missing CLOUDFLARE_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY env vars",
  );
}

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
});

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".pdf": "application/pdf",
  ".map": "application/json",
};

async function* walk(root: string): AsyncGenerator<string> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const p = join(root, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (entry.isFile()) yield p;
  }
}

async function listExistingKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    res.Contents?.forEach((o) => o.Key && keys.push(o.Key));
    token = res.NextContinuationToken;
  } while (token);
  return keys;
}

async function main() {
  await stat(dir).catch(() => {
    throw new Error(`Build dir not found: ${dir}`);
  });

  const prefix = `${hostname}/`;
  const uploaded = new Set<string>();

  for await (const file of walk(dir)) {
    const rel = relative(dir, file).split(sep).join("/");
    const key = `${prefix}${rel}`;
    const body = await readFile(file);
    const ext = "." + (rel.split(".").pop() ?? "");
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: MIME[ext] ?? "application/octet-stream",
      }),
    );
    uploaded.add(key);
    console.log(`  uploaded ${key} (${body.length} bytes)`);
  }

  const existing = await listExistingKeys(prefix);
  const stale = existing.filter((k) => !uploaded.has(k));
  if (stale.length) {
    for (let i = 0; i < stale.length; i += 1000) {
      const batch = stale.slice(i, i + 1000);
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })) },
        }),
      );
      batch.forEach((k) => console.log(`  deleted ${k}`));
    }
  }

  console.log(
    `\nDeployed ${uploaded.size} files to ${hostname}, pruned ${stale.length}.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
