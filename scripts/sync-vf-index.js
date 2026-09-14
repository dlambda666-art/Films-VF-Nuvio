import { readFile, writeFile } from "node:fs/promises";

const BASE = "https://doublagevf.fr/api";
const INDEX_FILE = "vf-index.json";

const PAGE_SIZE = Number(process.env.PAGE_SIZE || 50);
const MAX_PAGES = Number(process.env.MAX_PAGES || 428);
const CONCURRENCY = Number(process.env.CONCURRENCY || 8);
const REQUEST_DELAY_MS = Number(process.env.REQUEST_DELAY_MS || 100);
const FULL_SYNC = process.env.FULL_SYNC === "1";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function getJson(path) {
  const response = await fetch(`${BASE}${path}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Films-VF-Nuvio/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${path}`);
  }

  return response.json();
}

async function fetchBrowsePage(page) {
  const skip = (page - 1) * PAGE_SIZE;
  return getJson(`/works/browse?skip=${skip}&limit=${PAGE_SIZE}`);
}

function isFilm(work) {
  return String(work?.type || work?.work_type || "").toUpperCase() === "FILM";
}

function getYear(work) {
  const raw = work?.year ?? work?.release_year ?? work?.release_date;
  const match = String(raw ?? "").match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function extractTmdbId(value) {
  if (value == null) return null;

  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string") {
    const m = value.match(/(?:movie[/:]|themoviedb\.org\/movie\/)(\d+)/i);
    if (m) return Number(m[1]);
    if (/^\d+$/.test(value)) return Number(value);
  }

  return null;
}

function findTmdbId(obj) {
  if (!obj || typeof obj !== "object") return null;

  const directKeys = [
    "tmdb_id", "tmdbId", "tmdb", "tmdb_movie_id",
    "external_id", "externalId", "tmdb_url"
  ];

  for (const key of directKeys) {
    const id = extractTmdbId(obj[key]);
    if (id) return id;
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      const id = findTmdbId(value);
      if (id) return id;
    }
  }

  return null;
}

async function resolveTmdb(work) {
  // Fast path: some API responses may already contain TMDB information.
  const direct = findTmdbId(work);
  if (direct) return direct;

  // Preferred: work detail endpoint.
  for (const route of [
    `/work/${encodeURIComponent(work.id)}`,
    `/works/${encodeURIComponent(work.id)}`
  ]) {
    try {
      const detail = await getJson(route);
      const id = findTmdbId(detail);
      if (id) return id;
    } catch {}
  }

  // Fallback: universal search by exact title.
  if (!work.title) return null;

  try {
    const q = encodeURIComponent(work.title);
    const data = await getJson(`/search/universal?q=${q}`);
    const works = Array.isArray(data?.works) ? data.works : [];

    const year = getYear(work);
    const exact = works.filter(x =>
      String(x?.work_type || "").toUpperCase() === "FILM" &&
      String(x?.title || "").trim().toLowerCase() ===
        String(work.title).trim().toLowerCase()
    );

    const pool = exact.length ? exact : works.filter(x =>
      String(x?.work_type || "").toUpperCase() === "FILM"
    );

    if (!pool.length) return null;

    if (year != null) {
      const sameYear = pool.find(x => Number(x?.year) === year);
      if (sameYear?.tmdb_id) return Number(sameYear.tmdb_id);
    }

    const candidate = pool.find(x => Number.isInteger(Number(x?.tmdb_id)));
    return candidate ? Number(candidate.tmdb_id) : null;
  } catch {
    return null;
  }
}

async function mapWithConcurrency(items, worker, concurrency) {
  const results = new Array(items.length);
  let cursor = 0;

  async function run() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;

      results[index] = await worker(items[index], index);
      if (REQUEST_DELAY_MS) await sleep(REQUEST_DELAY_MS);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, run)
  );

  return results;
}

async function loadExisting() {
  try {
    const raw = await readFile(INDEX_FILE, "utf8");
    const data = JSON.parse(raw);
    const items = Array.isArray(data) ? data : data.items;
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

async function main() {
  const existing = loadExisting();
  const existingItems = await existing;

  const byTmdb = new Map(
    existingItems
      .filter(x => Number.isInteger(Number(x?.tmdb_id)))
      .map(x => [Number(x.tmdb_id), x])
  );

  // A normal scheduled run scans the current first page(s).
  // FULL_SYNC=1 scans the complete DoublageVF catalog.
  const pages = FULL_SYNC ? MAX_PAGES : 8;

  let scannedWorks = 0;
  let filmWorks = 0;
  let resolved = 0;

  for (let page = 1; page <= pages; page++) {
    let payload;

    try {
      payload = await fetchBrowsePage(page);
    } catch (error) {
      console.error(`Page ${page} failed: ${error.message}`);
      continue;
    }

    const works = Array.isArray(payload?.works) ? payload.works : [];
    if (!works.length) break;

    scannedWorks += works.length;

    const films = works.filter(isFilm);
    filmWorks += films.length;

    const resolvedPage = await mapWithConcurrency(
      films,
      async work => {
        const tmdbId = await resolveTmdb(work);

        if (!tmdbId) {
          console.log(`TMDB introuvable: ${work.title}`);
          return null;
        }

        resolved++;
        return {
          id: work.id,
          tmdb_id: tmdbId,
          title: work.title || null,
          year: getYear(work),
          vf_confirmed: true,
          vf_country: "FR",
          source: "DoublageVF",
          confidence: 1,
          status: "confirmed",
          last_verified: new Date().toISOString()
        };
      },
      CONCURRENCY
    );

    for (const item of resolvedPage) {
      if (item) {
        const previous = byTmdb.get(item.tmdb_id);
        byTmdb.set(item.tmdb_id, {
          ...previous,
          ...item
        });
      }
    }

    console.log(
      `Page ${page}/${pages}: ${works.length} œuvres, ${films.length} films, ` +
      `${resolvedPage.filter(Boolean).length} TMDB résolus.`
    );

    // On a reached the end of the browse catalogue.
    const pagination = payload?.pagination;
    if (pagination) {
      const totalPages =
        Number(pagination.total_pages) ||
        Number(pagination.pages) ||
        Number(pagination.last_page);

      if (Number.isFinite(totalPages) && page >= totalPages) break;
    }

    if (works.length < PAGE_SIZE) break;
  }

  const items = [...byTmdb.values()]
    .filter(x => Number.isInteger(Number(x.tmdb_id)) && Number(x.tmdb_id) > 0)
    .map(x => ({
      id: x.id || null,
      tmdb_id: Number(x.tmdb_id),
      title: x.title || null,
      year: x.year || null,
      vf_confirmed: true,
      vf_country: x.vf_country || "FR",
      source: x.source || "DoublageVF",
      confidence: Number(x.confidence ?? 1),
      status: "confirmed",
      last_verified: x.last_verified || new Date().toISOString()
    }))
    .sort((a, b) => {
      const ay = Number(a.year || 0);
      const by = Number(b.year || 0);
      return by - ay || String(a.title || "").localeCompare(String(b.title || ""));
    });

  const output = {
    version: 2,
    updated_at: new Date().toISOString(),
    source: "DoublageVF",
    items
  };

  await writeFile(INDEX_FILE, JSON.stringify(output, null, 2) + "\n", "utf8");

  console.log("");
  console.log(`Œuvres scannées : ${scannedWorks}`);
  console.log(`Films trouvés   : ${filmWorks}`);
  console.log(`TMDB résolus    : ${resolved}`);
  console.log(`Index final     : ${items.length}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
