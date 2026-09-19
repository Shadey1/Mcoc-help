/**
 * Download a GuiaMTC season page's images into a local folder.
 *
 * The guide is a Google Sites page: image URLs are in the plain HTML, so
 * no browser is needed. But the URLs are signed and expire about a
 * minute after the page request, and need that request's cookies. So
 * images are pulled in parallel straight after the page, and anything
 * that still gets refused is retried against a freshly loaded page.
 */

import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const CONCURRENCY = 8;
const MAX_ROUNDS = 4;

type Page = { urls: string[]; cookie: string };

/** fetch() that treats a dropped connection like any other failed attempt. */
async function tryFetch(url: string, headers: Record<string, string>): Promise<Response | null> {
  try {
    return await fetch(url, { headers });
  } catch {
    return null;
  }
}

async function loadPage(pageUrl: string): Promise<Page> {
  let res: Response | null = null;
  for (let attempt = 1; attempt <= 3 && !res; attempt++) res = await tryFetch(pageUrl, { 'user-agent': UA });
  if (!res) throw new Error(`Could not reach ${pageUrl}. Check the connection and run again.`);
  if (!res.ok) throw new Error(`${pageUrl} returned HTTP ${res.status}`);
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const html = await res.text();
  // Keyed by DOM position, not URL: the signed URLs differ on every load.
  const urls = [...html.matchAll(/<img[^>]+src="(https:\/\/[^"]+googleusercontent[^"]+)"/g)].map((m) =>
    m[1]!.replace(/&amp;/g, '&'),
  );
  if (urls.length === 0) throw new Error(`No images found on ${pageUrl}: has the guide moved off Google Sites?`);
  return { urls, cookie };
}

/** Returns the number of images saved. Throws, leaving any previous
 *  download in `outDir` untouched, unless every image was fetched. */
export async function fetchGuideImages(pageUrl: string, outDir: string): Promise<number> {
  const staging = `${outDir}.partial`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });

  let page = await loadPage(pageUrl);
  const total = page.urls.length;
  let pending = page.urls.map((_, i) => i);

  for (let round = 1; pending.length > 0 && round <= MAX_ROUNDS; round++) {
    if (round > 1) {
      page = await loadPage(pageUrl);
      if (page.urls.length !== total) throw new Error('The guide page changed while it was being downloaded. Run again.');
    }
    const failed: number[] = [];
    const queue = [...pending];
    const current = page;
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        for (let i = queue.shift(); i !== undefined; i = queue.shift()) {
          const res = await tryFetch(current.urls[i]!, { 'user-agent': UA, referer: pageUrl, cookie: current.cookie });
          const ext = res ? EXT[res.headers.get('content-type')?.split(';')[0] ?? ''] : undefined;
          const body = res?.ok && ext ? await res.arrayBuffer().catch(() => null) : null;
          if (!body) {
            failed.push(i);
            continue;
          }
          writeFileSync(resolve(staging, `img-${String(i + 1).padStart(2, '0')}.${ext}`), Buffer.from(body));
        }
      }),
    );
    pending = failed;
  }

  if (pending.length > 0) {
    rmSync(staging, { recursive: true, force: true });
    throw new Error(`${pending.length} of ${total} guide images could not be downloaded after ${MAX_ROUNDS} attempts.`);
  }
  rmSync(outDir, { recursive: true, force: true });
  renameSync(staging, outDir);
  return total;
}
