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
  if (value == null) return null;

  const match = String(value).match(
    /\b(?:19|20)\d{2}\b/
  );

  return match ? Number(match[0]) : null;
}

function findYear(work) {
  if (!work || typeof work !== "object") {
    return null;
  }

  for (const key of [
    "year",
    "release_year",
    "releaseYear",
    "release_date",
    "releaseDate"
  ]) {
    const year = extractYear(work[key]);

    if (year) return year;
  }

  return null;
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

  if (typeof value === "string") {
    const text = value.trim();

    if (/^\d+$/.test(text)) {
      const id = Number(text);
      return id > 0 ? id : null;
    }

    const match = text.match(
      /(?:themoviedb\.org\/movie\/|movie[/:])(\d+)/i
    );

    if (match) {
      return Number(match[1]);
    }
  }

  return null;
}

function findTmdbId(obj) {
  if (!obj || typeof obj !== "object") {
    return null;
  }

  const keys = [
    "tmdb_id",
    "tmdbId",
    "tmdb_movie_id",
    "tmdbMovieId",
    "tmdb"
  ];

  for (const key of keys) {
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

async function getDoublageVF(path) {
  for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
    const response = await fetch(
      `${DOUBLAGEVF_BASE}${path}`,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "Films-VF-Nuvio/1.0"
        }
      }
    );

    if (response.ok) {
      return response.json();
    }

    if (response.status === 429) {
      if (attempt >= MAX_429_RETRIES) {
        throw new Error(`429 ${path}`);
      }

      const retryAfter = Number(
        response.headers.get("retry-after")
      );

      const wait =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(
              retryAfter * 1000,
              MAX_429_WAIT_MS
            )
          : MAX_429_WAIT_MS;

      console.log(
        `DoublageVF 429 -> attente ${Math.round(
          wait / 1000
        )}s`
      );

      await sleep(wait);
      continue;
    }

    throw new Error(
      `${response.status} ${path}`
    );
  }

  throw new Error("DoublageVF request failed");
}

async function getTMDB(path) {
  if (!TMDB_API_KEY) {
    throw new Error(
      "TMDB_API_KEY manquante dans GitHub Actions"
    );
  }

  const url = new URL(
    `${TMDB_BASE}${path}`
  );

  url.searchParams.set(
    "api_key",
    TMDB_API_KEY
  );

  url.searchParams.set(
    "language",
    "fr-FR"
  );

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Films-VF-Nuvio/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(
      `TMDB ${response.status}`
    );
  }

  return response.json();
}

const tmdbCache = new Map();

async function searchTMDB(title, year) {
  const key =
    `${normalizeTitle(title)}|${year || ""}`;

  if (tmdbCache.has(key)) {
    return tmdbCache.get(key);
  }

  let result = null;

  try {
    const params = new URLSearchParams();

    params.set(
      "query",
      title
    );

    params.set(
      "include_adult",
      "false"
    );

    if (year) {
      params.set(
        "year",
        String(year)
      );
    }

    const data = await getTMDB(
      `/search/movie?${params.toString()}`
    );

    const results =
      Array.isArray(data?.results)
        ? data.results
        : [];

    const normalized =
      normalizeTitle(title);

    let candidates = results;

    if (year) {
      const sameYear =
        results.filter(movie => {
          const movieYear =
            extractYear(
              movie?.release_date
            );

          return movieYear === year;
        });

      if (sameYear.length) {
        candidates = sameYear;
      }
    }

    const exact =
      candidates.find(movie => {
        const a =
          normalizeTitle(
            movie?.title
          );

        const b =
          normalizeTitle(
            movie?.original_title
          );

        return (
          a === normalized ||
          b === normalized
        );
      });

    const candidate =
      exact ||
      candidates[0] ||
      null;

    if (candidate?.id) {
      result = {
        tmdb_id: Number(candidate.id),
        year:
          extractYear(
            candidate.release_date
          ) ||
          year ||
          null
      };
    }
  } catch (error) {
    console.log(
      `TMDB recherche échouée: ${title} -> ${error.message}`
    );
  }

  tmdbCache.set(key, result);

  return result;
}

async function mapWithConcurrency(
  items,
  worker,
  concurrency
) {
  const results =
    new Array(items.length);

  let cursor = 0;

  async function runner() {
    while (true) {
      const index = cursor++;

      if (index >= items.length) {
        return;
      }

      results[index] =
        await worker(
          items[index],
          index
        );

      if (TMDB_DELAY_MS) {
        await sleep(
          TMDB_DELAY_MS
        );
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
      runner
    )
  );

  return results;
}

async function loadExistingIndex() {
  try {
    const raw =
      await readFile(
        INDEX_FILE,
        "utf8"
      );

    const data =
      JSON.parse(raw);

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
    const id =
      Number(item?.tmdb_id);

    if (
      Number.isInteger(id) &&
      id > 0
    ) {
      map.set(id, item);
    }
  }

  return map;
}

function pageSignature(works) {
  return works
    .slice(0, 10)
    .map(work =>
      String(
        work?.id ||
        work?.title ||
        ""
      )
    )
    .join("|");
}

async function main() {
  console.log(
    "=== Films VF Nuvio ==="
  );

  if (!TMDB_API_KEY) {
    throw new Error(
      "TMDB_API_KEY manquante dans GitHub Actions. " +
      "Le secret doit être transmis au workflow."
    );
  }

  console.log(
    `TMDB API : OK`
  );

  console.log(
    `Mode : ${
      FULL_SYNC
        ? "FULL"
        : "standard"
    }`
  );

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

  const signatures =
    new Set();

  for (
    let page = 1;
    page <= MAX_PAGES;
    page++
  ) {
    let payload;

    try {
      payload =
        await getDoublageVF(
          `/works/browse?skip=${
            (page - 1) * PAGE_SIZE
          }&limit=${PAGE_SIZE}`
        );
    } catch (error) {
      console.error(
        `Arrêt page ${page}: ${error.message}`
      );
      break;
    }

    const works =
      Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.works)
          ? payload.works
          : Array.isArray(payload?.items)
            ? payload.items
            : [];

    if (!works.length) {
      console.log(
        `Page ${page}: vide -> fin`
      );
      break;
    }

    const signature =
      pageSignature(works);

    if (signatures.has(signature)) {
      console.log(
        `Page ${page}: contenu déjà rencontré -> fin du scan`
      );
      break;
    }

    signatures.add(signature);

    scanned += works.length;

    const pageFilms =
      works.filter(isFilm);

    films += pageFilms.length;

    const pageResults =
      await mapWithConcurrency(
        pageFilms,
        async work => {
          const title =
            extractTitle(work);

          const year =
            findYear(work);

          let tmdbId =
            findTmdbId(work);

          let resolvedYear =
            year;

          if (!tmdbId && title) {
            const found =
              await searchTMDB(
                title,
                year
              );

            if (found) {
              tmdbId =
                found.tmdb_id;

              resolvedYear =
                found.year ||
                year;

              resolved++;
            } else {
              console.log(
                `TMDB absent: ${title}`
              );
            }
          } else if (tmdbId) {
            resolved++;
          }

          if (!tmdbId) {
            return null;
          }

          return {
            id:
              work?.id ||
              null,
            tmdb_id:
              Number(tmdbId),
            title:
              title ||
              null,
            year:
              resolvedYear ||
              null,
            vf_confirmed: true,
            vf_country: "FR",
            source: "DoublageVF",
            confidence: 1,
            status: "confirmed",
            last_verified:
              new Date().toISOString()
          };
        },
        TMDB_CONCURRENCY
      );

    for (const item of pageResults) {
      if (!item) continue;

      const previous =
        index.get(
          item.tmdb_id
        );

      index.set(
        item.tmdb_id,
        {
          ...(previous || {}),
          ...item,
          year:
            item.year ||
            previous?.year ||
            null
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

    if (
      works.length < PAGE_SIZE
    ) {
      break;
    }

    await sleep(
      PAGE_DELAY_MS
    );
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
        id:
          item.id ||
          null,
        tmdb_id:
          Number(item.tmdb_id),
        title:
          item.title ||
          null,
        year:
          item.year
            ? Number(item.year)
            : null,
        vf_confirmed: true,
        vf_country:
          item.vf_country ||
          "FR",
        source:
          item.source ||
          "DoublageVF",
        confidence:
          Number(
            item.confidence ?? 1
          ),
        status:
          "confirmed",
        last_verified:
          item.last_verified ||
          new Date().toISOString()
      }))
      .sort((a, b) => {
        const yearDiff =
          Number(b.year || 0) -
          Number(a.year || 0);

        if (yearDiff !== 0) {
          return yearDiff;
        }

        return String(
          a.title || ""
        ).localeCompare(
          String(b.title || "")
        );
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

  console.log("");
  console.log(
    "=== RESULTAT ==="
  );
  console.log(
    `Pages : ${pages}`
  );
  console.log(
    `Œuvres : ${scanned}`
  );
  console.log(
    `Films : ${films}`
  );
  console.log(
    `TMDB résolus : ${resolved}`
  );
  console.log(
    `Index final : ${items.length}`
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
