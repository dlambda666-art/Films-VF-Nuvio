import fs from "node:fs/promises";

const BASE = "https://doublagevf.fr";
const INDEX_FILE = "vf-index.json";

const FULL_SYNC = process.env.FULL_SYNC === "1";
const PAGE_COUNT = Number(process.env.PAGE_COUNT || (FULL_SYNC ? 428 : 12));
const CONCURRENCY = Number(process.env.CONCURRENCY || 3);
const REQUEST_DELAY_MS = Number(process.env.REQUEST_DELAY_MS || 350);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function stripHtml(value) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Films-VF-Nuvio/1.0 (+https://github.com/dlambda666-art/Films-VF-Nuvio)"
    }
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${url}`);
  }

  return response.text();
}

function extractWorkLinks(html) {
  const found = new Map();
  const re = /href=["'](\/work\/[^"'?#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(re)) {
    const href = match[1];
    const label = stripHtml(match[2]);

    if (!/\bFilm\b/i.test(label)) continue;

    const title = label.replace(/\s*Film\s*$/i, "").trim();
    if (!title) continue;

    found.set(href, { href, title });
  }

  return [...found.values()];
}

function extractYear(text) {
  const match = text.match(/\bFilm\s+(19\d{2}|20\d{2})\b/i);
  return match ? Number(match[1]) : null;
}

function extractTmdbId(text) {
  const patterns = [
    /themoviedb\.org\/movie\/(\d+)/i,
    /tmdb(?:_id|Id|ID)?["':=\s]+(\d{2,10})/i,
    /["']tmdb["']\s*:\s*["']?(\d{2,10})/i,
    /movie\/(\d{2,10})["']/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return Number(match[1]);
  }

  return null;
}

function isConfirmedVF(text) {
  return /Doublage français\s*\(\s*\d+/i.test(text);
}

async function fetchWork(item) {
  const html = await fetchText(`${BASE}${item.href}`);
  const text = stripHtml(html);

  if (!isConfirmedVF(text)) return null;

  const tmdbId = extractTmdbId(html) || extractTmdbId(text);
  if (!tmdbId) return null;

  return {
    tmdb_id: tmdbId,
    title: item.title,
    year: extractYear(text),
    vf_confirmed: true,
    vf_country: null,
    source: "DoublageVF",
    confidence: 1,
    status: "confirmed",
    last_verified: new Date().toISOString()
  };
}

async function mapConcurrent(items, worker, concurrency) {
  const results = [];
  let cursor = 0;

  async function run() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;

      try {
        const result = await worker(items[index]);
        if (result) results.push(result);
      } catch (error) {
        console.warn("Skipped:", items[index].href, error.message);
      }

      await sleep(REQUEST_DELAY_MS);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, run));
  return results;
}

async function main() {
  let existing = { version: 1, updated_at: null, items: [] };

  try {
    existing = JSON.parse(await fs.readFile(INDEX_FILE, "utf8"));
  } catch {}

  const byTmdb = new Map(
    (existing.items || [])
      .filter(item => Number.isInteger(Number(item.tmdb_id)))
      .map(item => [Number(item.tmdb_id), item])
  );

  for (let page = 1; page <= PAGE_COUNT; page++) {
    console.log(`Scanning DoublageVF works page ${page}/${PAGE_COUNT}`);

    let html;
    try {
      html = await fetchText(`${BASE}/works?page=${page}`);
    } catch (error) {
      console.warn("Page skipped:", error.message);
      continue;
    }

    const works = extractWorkLinks(html);
    console.log(`  ${works.length} films found`);

    const records = await mapConcurrent(
      works,
      fetchWork,
      CONCURRENCY
    );

    for (const record of records) {
      const old = byTmdb.get(record.tmdb_id);
      byTmdb.set(record.tmdb_id, {
        ...(old || {}),
        ...record
      });
    }
  }

  const items = [...byTmdb.values()]
    .filter(item => item.vf_confirmed === true)
    .sort((a, b) => {
      const ya = Number(a.year || 0);
      const yb = Number(b.year || 0);
      if (yb !== ya) return yb - ya;
      return String(a.title || "").localeCompare(String(b.title || ""), "fr");
    });

  const output = {
    version: 1,
    updated_at: new Date().toISOString(),
    items
  };

  await fs.writeFile(INDEX_FILE, JSON.stringify(output, null, 2) + "\n");
  console.log(`VF index updated: ${items.length} confirmed films`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
