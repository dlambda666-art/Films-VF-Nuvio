import { readFile, writeFile } from "node:fs/promises";

const DOUBLAGEVF_BASE = "https://doublagevf.fr/api";
const TMDB_BASE = "https://api.themoviedb.org/3";
const INDEX_FILE = "vf-index.json";

const PAGE_SIZE = 50;

const TMDB_API_KEY = process.env.TMDB_API_KEY || "";
const FULL_SYNC = process.env.FULL_SYNC === "1";

const MAX_PAGES = FULL_SYNC ? 428 : 10;

const PAGE_DELAY_MS = 3000;
const TMDB_DELAY_MS = 150;
const TMDB_CONCURRENCY = 5;

const MAX_429_RETRIES = 3;
const MAX_429_WAIT_MS = 30000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeTitle(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function extractYear(value) {
  const match = String(value ?? "").match(/\b(?:19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function extractTitle(work) {
  return (
    work?.title ||
    work?.name ||
    work?.original_title ||
    work?.originalTitle ||
    null
  );
}

function findYear(work) {
  for (const key of [
    "year",
    "release_year",
    "releaseYear",
    "release_date",
    "releaseDate"
  ]) {
    const year = extractYear(work?.[key]);
    if (year) return year;
  }

  return null;
}

function isFilm(work) {
  const type = String(
    work?.type ||
    work?.work_type ||
    work?.media_type ||
    ""
  ).toUpperCase();

  return type === "FILM";
}

function extractTmdbId(value) {
  if (value == null) return null;

  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0
  ) {
    return value;
  }

  const text = String(value).trim();

  if (/^\d+$/.test(text)) {
    const id = Number(text);
    return id > 0 ? id : null;
  }

  const match = text.match(
    /(?:themoviedb\.org\/movie\/|movie[/:])(\d+)/i
  );

  return match ? Number(match[1]) : null;
}

function findTmdbId(obj) {
  if (!obj || typeof obj !== "object") return null;

  for (const key of [
    "tmdb_id",
    "tmdbId",
    "tmdb_movie_id",
    "tmdbMovieId",
    "tmdb"
  ]) {
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

function normalizePayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.works)) return payload.works;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
}

function pageSignature(works) {
  return works
    .slice(0, 10)
    .map(work =>
      String(
        work?.id ||
        work?.uuid ||
        work?.title ||
        work?.name ||
        ""
      )
    )
    .join("|");
}

async function fetchJson(url, label) {
  for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Films-VF-Nuvio/1.0"
      }
    });

    if (response.ok) {
      return response.json();
    }

    if (
      response.status === 429 &&
      attempt < MAX_429_RETRIES
    ) {
      const retryAfter = Number(
        response.headers.get("retry-after")
      );

      const wait =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter * 1000, MAX_429_WAIT_MS)
          : MAX_429_WAIT_MS;

      console.log(
        `${label}: 429 -> attente ${Math.round(wait / 1000)}s`
      );

      await sleep(wait);
      continue;
    }

    throw new Error(
      `${label}: HTTP ${response.status}`
    );
  }

  throw new Error(`${label}: requête impossible`);
}

async function getDoublageVF(path) {
  return fetchJson(
    `${DOUBLAGEVF_BASE}${path}`,
    `DoublageVF ${path}`
  );
}

async function getTMDB(path) {
  if (!TMDB_API_KEY) {
    throw new Error("TMDB_API_KEY manquante");
  }

  const url = new URL(`${TMDB_BASE}${path}`);

  url.searchParams.set("api_key", TMDB_API_KEY);
  url.searchParams.set("language", "fr-FR");

  return fetchJson(url, "TMDB");
}

const tmdbCache = new Map();

async function searchTMDB(title, year) {
  const cacheKey =
    `${normalizeTitle(title)}|${year || ""}`;

  if (tmdbCache.has(cacheKey)) {
    return tmdbCache.get(cacheKey);
  }

  const searches = [];

  if (year) {
    searches.push({ query: title, year });
  }

  searches.push({ query: title });

  let result = null;

  for (const search of searches) {
    try {
      const params = new URLSearchParams({
        query: search.query,
        include_adult: "false"
      });

      if (search.year) {
        params.set("year", String(search.year));
      }

      const data = await getTMDB(
        `/search/movie?${params.toString()}`
      );

      const results = Array.isArray(data?.results)
        ? data.results
        : [];

      if (!results.length) continue;

      const wanted = normalizeTitle(title);

      const sameYear = year
        ? results.filter(movie =>
            extractYear(movie?.release_date) === year
          )
        : results;

      const candidates =
        sameYear.length ? sameYear : results;

      const exact = candidates.find(movie => {
        const a = normalizeTitle(movie?.title);
        const b = normalizeTitle(movie?.original_title);

        return a === wanted || b === wanted;
      });

      const candidate = exact || candidates[0];

      if (candidate?.id) {
        result = {
          tmdb_id: Number(candidate.id),
          year:
            extractYear(candidate.release_date) ||
            year ||
            null
        };

        break;
      }
    } catch (error) {
      console.log(
        `TMDB recherche échouée: ${title} -> ${error.message}`
      );
    }
  }

  tmdbCache.set(cacheKey, result);
  return result;
}

async function mapWithConcurrency(items, worker, concurrency) {
  const results = new Array(items.length);
  let cursor = 0;

  async function runner() {
    while (true) {
      const index = cursor++;

      if (index >= items.length) return;

      results[index] = await worker(
        items[index],
        index
      );

      if (TMDB_DELAY_MS) {
        await sleep(TMDB_DELAY_MS);
      }
    }
  }

  const count = Math.min(
    concurrency,
    items.length
  );

  await Promise.all(
    Array.from(
      { length: count },
      () => runner()
    )
  );

  return results;
}

async function loadExistingIndex() {
  try {
    const raw = await readFile(
      INDEX_FILE,
      "utf8"
    );

    const data = JSON.parse(raw);

    const items =
      Array.isArray(data)
        ? data
        : data?.items;

    return Array.isArray(items)
      ? items
      : [];
  } catch {
    return [];
  }
}

function createIndexMap(items) {
  const map = new Map();

  for (const item of items) {
    const id = Number(item?.tmdb_id);

    if (
      Number.isInteger(id) &&
      id > 0
    ) {
      map.set(id, item);
    }
  }

  return map;
}

/*
 * Détection automatique du vrai système de pagination.
 *
 * On récupère d'abord la page 1.
 * Ensuite on teste plusieurs mécanismes possibles.
 * Le premier qui produit une page différente est retenu.
 */
async function detectPagination(firstWorks) {
  const firstSignature =
    pageSignature(firstWorks);

  const tests = [
    {
      name: "skip",
      path: `/works/browse?skip=${PAGE_SIZE}&limit=${PAGE_SIZE}`
    },
    {
      name: "offset",
      path: `/works/browse?offset=${PAGE_SIZE}&limit=${PAGE_SIZE}`
    },
    {
      name: "page",
      path: `/works/browse?page=2&limit=${PAGE_SIZE}`
    },
    {
      name: "pageNumber",
      path: `/works/browse?pageNumber=2&limit=${PAGE_SIZE}`
    },
    {
      name: "page_size",
      path: `/works/browse?page=2&page_size=${PAGE_SIZE}`
    },
    {
      name: "start",
      path: `/works/browse?start=${PAGE_SIZE}&limit=${PAGE_SIZE}`
    }
  ];

  for (const test of tests) {
    try {
      const payload =
        await getDoublageVF(test.path);

      const works =
        normalizePayload(payload);

      if (!works.length) continue;

      const signature =
        pageSignature(works);

      if (
        signature &&
        signature !== firstSignature
      ) {
        console.log(
          `Pagination détectée : ${test.name}`
        );

        return {
          name: test.name,
          getPath(page) {
            if (test.name === "skip") {
              return `/works/browse?skip=${
                (page - 1) * PAGE_SIZE
              }&limit=${PAGE_SIZE}`;
            }

            if (test.name === "offset") {
              return `/works/browse?offset=${
                (page - 1) * PAGE_SIZE
              }&limit=${PAGE_SIZE}`;
            }

            if (test.name === "page") {
              return `/works/browse?page=${page}&limit=${PAGE_SIZE}`;
            }

            if (test.name === "pageNumber") {
              return `/works/browse?pageNumber=${page}&limit=${PAGE_SIZE}`;
            }

            if (test.name === "page_size") {
              return `/works/browse?page=${page}&page_size=${PAGE_SIZE}`;
            }

            return `/works/browse?start=${
              (page - 1) * PAGE_SIZE
            }&limit=${PAGE_SIZE}`;
          }
        };
      }
    } catch (error) {
      console.log(
        `Test pagination ${test.name}: ${error.message}`
      );
    }

    await sleep(500);
  }

  return null;
}

function buildRecord(work, tmdb) {
  return {
    id: work?.id || null,
    tmdb_id: Number(tmdb.tmdb_id),
    title: extractTitle(work),
    year: tmdb.year || findYear(work) || null,
    vf_confirmed: true,
    vf_country: "FR",
    source: "DoublageVF",
    confidence: 1,
    status: "confirmed",
    last_verified: new Date().toISOString()
  };
}

async function main() {
  console.log("=== Films VF Nuvio ===");

  if (!TMDB_API_KEY) {
    throw new Error(
      "TMDB_API_KEY manquante dans GitHub Actions"
    );
  }

  console.log("TMDB API : OK");
  console.log(
    `Mode : ${FULL_SYNC ? "FULL" : "standard"}`
  );
  console.log(`Pages max : ${MAX_PAGES}`);

  const existing =
    await loadExistingIndex();

  const index =
    createIndexMap(existing);

  console.log(
    `Index existant : ${index.size}`
  );

  let scanned = 0;
  let films = 0;
  let resolved = 0;
  let pages = 0;

  const signatures = new Set();

  /*
   * Première page.
   */
  const firstPayload =
    await getDoublageVF(
      `/works/browse?skip=0&limit=${PAGE_SIZE}`
    );

  const firstWorks =
    normalizePayload(firstPayload);

  if (!firstWorks.length) {
    throw new Error(
      "DoublageVF ne retourne aucune œuvre"
    );
  }

  console.log(
    `Page 1/${MAX_PAGES}: ${firstWorks.length} œuvres`
  );

  const pagination =
    await detectPagination(firstWorks);

  if (!pagination) {
    throw new Error(
      "Impossible de déterminer la pagination DoublageVF"
    );
  }

  async function processPage(page, works) {
    const pageFilms =
      works.filter(isFilm);

    films += pageFilms.length;
    scanned += works.length;

    const pageResults =
      await mapWithConcurrency(
        pageFilms,
        async work => {
          const title =
            extractTitle(work);

          const year =
            findYear(work);

          if (!title) return null;

          let tmdbId =
            findTmdbId(work);

          let tmdbResult = null;

          if (tmdbId) {
            tmdbResult = {
              tmdb_id: tmdbId,
              year
            };
          } else {
            tmdbResult =
              await searchTMDB(
                title,
                year
              );
          }

          if (!tmdbResult) {
            console.log(
              `TMDB absent: ${title}${
                year ? ` (${year})` : ""
              }`
            );

            return null;
          }

          resolved++;

          return buildRecord(
            work,
            tmdbResult
          );
        },
        TMDB_CONCURRENCY
      );

    for (const item of pageResults) {
      if (!item) continue;

      const previous =
        index.get(item.tmdb_id);

      index.set(
        item.tmdb_id,
        {
          ...(previous || {}),
          ...item
        }
      );
    }

    pages++;

    console.log(
      `Page ${page}/${MAX_PAGES}: ` +
      `${works.length} œuvres, ` +
      `${pageFilms.length} films, ` +
      `${pageResults.filter(Boolean).length} TMDB résolus, ` +
      `Index: ${index.size}`
    );
  }

  /*
   * Traite la première page.
   */
  signatures.add(
    pageSignature(firstWorks)
  );

  await processPage(
    1,
    firstWorks
  );

  /*
   * Pages suivantes.
   */
  for (
    let page = 2;
    page <= MAX_PAGES;
    page++
  ) {
    await sleep(PAGE_DELAY_MS);

    let payload;

    try {
      payload =
        await getDoublageVF(
          pagination.getPath(page)
        );
    } catch (error) {
      console.error(
        `Arrêt page ${page}: ${error.message}`
      );

      break;
    }

    const works =
      normalizePayload(payload);

    if (!works.length) {
      console.log(
        `Page ${page}: vide -> fin`
      );

      break;
    }

    const signature =
      pageSignature(works);

    if (
      signatures.has(signature)
    ) {
      console.log(
        `Page ${page}: contenu déjà rencontré -> fin`
      );

      break;
    }

    signatures.add(signature);

    await processPage(
      page,
      works
    );

    if (
      works.length < PAGE_SIZE
    ) {
      break;
    }
  }

  const items =
    [...index.values()]
      .filter(item => {
        const id =
          Number(item?.tmdb_id);

        return (
          Number.isInteger(id) &&
          id > 0
        );
      })
      .map(item => ({
        id: item.id || null,
        tmdb_id: Number(item.tmdb_id),
        title: item.title || null,
        year: item.year
          ? Number(item.year)
          : null,
        vf_confirmed: true,
        vf_country:
          item.vf_country || "FR",
        source:
          item.source || "DoublageVF",
        confidence:
          Number(item.confidence ?? 1),
        status: "confirmed",
        last_verified:
          item.last_verified ||
          new Date().toISOString()
      }))
      .sort((a, b) => {
        const yearA =
          Number(a.year || 0);

        const yearB =
          Number(b.year || 0);

        return yearB - yearA;
      });

  const output = {
    version: 2,
    updated_at:
      new Date().toISOString(),
    source: "DoublageVF",
    items
  };

  await writeFile(
    INDEX_FILE,
    JSON.stringify(
      output,
      null,
      2
    ) + "\n",
    "utf8"
  );

  console.log("=== RESULTAT ===");
  console.log(`Pages : ${pages}`);
  console.log(`Œuvres : ${scanned}`);
  console.log(`Films : ${films}`);
  console.log(`TMDB résolus : ${resolved}`);
  console.log(`Index final : ${items.length}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
