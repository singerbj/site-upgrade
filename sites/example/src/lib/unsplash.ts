// Build-time helper for fetching free stock images from Unsplash. Sites
// embed photos via the <UnsplashImage> component which calls into here
// during static generation.
//
// Requires UNSPLASH_ACCESS_KEY at build time (free tier: 50 req/hour).
// If unset, helpers return null and the component renders nothing — the
// site still builds.
//
// The Unsplash API license requires (a) attributing photographer + Unsplash
// with utm params and (b) firing the photo's download endpoint when the
// image is actually used. Both are handled here / in <UnsplashImage>.

const UTM = "utm_source=site-upgrade&utm_medium=referral";
const ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY;
const API = "https://api.unsplash.com";

export interface UnsplashPhoto {
  id: string;
  url: string;
  alt: string;
  width: number;
  height: number;
  blurHash: string | null;
  credit: {
    name: string;
    profileUrl: string;
  };
}

interface UnsplashApiPhoto {
  id: string;
  urls: { regular: string };
  alt_description: string | null;
  description: string | null;
  width: number;
  height: number;
  blur_hash: string | null;
  user: { name: string; links: { html: string } };
  links: { download_location: string };
}

async function authedFetch(path: string): Promise<Response | null> {
  if (!ACCESS_KEY) return null;
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Client-ID ${ACCESS_KEY}` },
  });
  if (!res.ok) {
    console.warn(`unsplash ${path} -> ${res.status}`);
    return null;
  }
  return res;
}

// The Unsplash API ToS requires triggering the download endpoint whenever
// a photo is "used" (rendered). We fire-and-forget here.
async function trackDownload(downloadLocation: string): Promise<void> {
  if (!ACCESS_KEY) return;
  await fetch(downloadLocation, {
    headers: { Authorization: `Client-ID ${ACCESS_KEY}` },
  }).catch(() => {});
}

function shape(p: UnsplashApiPhoto, query: string): UnsplashPhoto {
  return {
    id: p.id,
    url: p.urls.regular,
    alt: p.alt_description ?? p.description ?? query,
    width: p.width,
    height: p.height,
    blurHash: p.blur_hash,
    credit: {
      name: p.user.name,
      profileUrl: `${p.user.links.html}?${UTM}`,
    },
  };
}

export async function getRandomPhoto(
  query: string,
): Promise<UnsplashPhoto | null> {
  const res = await authedFetch(
    `/photos/random?query=${encodeURIComponent(query)}&content_filter=high&orientation=landscape`,
  );
  if (!res) return null;
  const data = (await res.json()) as UnsplashApiPhoto;
  await trackDownload(data.links.download_location);
  return shape(data, query);
}

export async function getPhoto(id: string): Promise<UnsplashPhoto | null> {
  const res = await authedFetch(`/photos/${encodeURIComponent(id)}`);
  if (!res) return null;
  const data = (await res.json()) as UnsplashApiPhoto;
  await trackDownload(data.links.download_location);
  return shape(data, data.alt_description ?? "photo");
}

export const UNSPLASH_HOMEPAGE = `https://unsplash.com/?${UTM}`;
