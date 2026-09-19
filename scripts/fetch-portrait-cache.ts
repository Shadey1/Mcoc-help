/**
 * Fetch every champion's reference portrait into
 * data/champions/portraits-cache/<id>.png. The AW season extractor
 * template-matches guide cells against these PNGs.
 *
 * Uses puppeteer-core to drive local Chrome (Fandom's CDN sits behind
 * Cloudflare's JS challenge, which no direct-fetch approach clears).
 *
 * Idempotent (skips champions already on disk). Pass --force to refetch.
 *
 * Usage:
 *   pnpm fetch-portraits
 *   pnpm fetch-portraits -- --force
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';

const SEED_PATH = resolve('data/champions/seed.json');
const IMAGES_DIR = resolve('data/champions/portraits-cache');
const RATE_LIMIT_MS = 300;
const NAV_TIMEOUT_MS = 30_000;

const FORCE = process.argv.slice(2).includes('--force');

function findChrome(): string {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
  ];
  for (const p of candidates) if (existsSync(p)) return p;
  throw new Error('Chrome not found. Set CHROME_PATH env var.');
}

type Champion = { id: string; name: string; portraitUrl?: string | null };

async function main(): Promise<void> {
  const seed = JSON.parse(readFileSync(SEED_PATH, 'utf-8')) as { champions: Champion[] };
  mkdirSync(IMAGES_DIR, { recursive: true });

  const withUrl = seed.champions.filter((c) => c.portraitUrl);
  const todo = withUrl.filter((c) => FORCE || !existsSync(resolve(IMAGES_DIR, `${c.id}.png`)));
  console.log(
    `${seed.champions.length} champions in seed, ${seed.champions.length - withUrl.length} without a portraitUrl, ${todo.length} to fetch`,
  );
  if (todo.length === 0) return;

  const chromePath = findChrome();
  console.log(`launching chrome at ${chromePath}`);
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });
  let ok = 0;
  let fail = 0;
  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    );
    await page.setViewport({ width: 512, height: 512 });

    for (let i = 0; i < todo.length; i++) {
      const c = todo[i]!;
      try {
        const response = await page.goto(c.portraitUrl!, {
          waitUntil: 'networkidle0',
          timeout: NAV_TIMEOUT_MS,
        });
        const status = response?.status() ?? 0;
        if (status !== 200) throw new Error(`HTTP ${status}`);
        writeFileSync(resolve(IMAGES_DIR, `${c.id}.png`), Buffer.from(await response!.buffer()));
        ok++;
        if ((i + 1) % 20 === 0 || i === todo.length - 1) console.log(`  [${i + 1}/${todo.length}] ${c.name}`);
      } catch (e) {
        fail++;
        console.warn(`  [${i + 1}/${todo.length}] ${c.name.padEnd(30)} FAIL ${e instanceof Error ? e.message : String(e)}`);
      }
      if (i < todo.length - 1) await sleep(RATE_LIMIT_MS);
    }
  } finally {
    await browser.close();
  }
  console.log(`\nDone. fetched=${ok} failed=${fail}`);
  if (fail > 0) process.exit(1);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
