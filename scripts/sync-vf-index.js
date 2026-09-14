import { readFile, writeFile } from "node:fs/promises";

const BASE = "https://doublagevf.fr/api";
const INDEX_FILE = "vf-index.json";

const PAGE_SIZE = 50;
const MAX_PAGES = 428;

// Une seule requête à la fois pour éviter le rate-limit.
const PAGE_DELAY_MS = 5000;

// En cas de 429, on attend au maximum 60 secondes.
// Si DoublageVF bloque encore, on arrête proprement
// sans détruire l'index existant.
const MAX_429_RETRIES = 2;
const MAX_429_WAIT_MS = 60000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getJson(path) {
  for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
    const response = await fetch(`${BASE}${path}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Films-VF-Nuvio/1.0"
      }
    });

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

      const wait = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, MAX_429_WAIT_MS)
        : MAX_429_WAIT_MS;

      console.log(
        `HTTP 429 sur ${path} -> attente ${Math.round(wait / 1000)}s`
      );

      await sleep(wait);
      continue;
    }

    throw new Error(`${response.status} ${path}`);
  }

  throw new Error(`Request failed: ${path}`);
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
  if (value == null) {
    return null;
  }

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

    if (id) {
      return id;
    }
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      const id = findTmdbId(value);

      if (id) {
        return id;
      }
    }
  }

  return null;
}

function extractYear(value) {
  if (value == null) {
    return null;
  }

  const match = String(value).match(
    /\b(?:19|20)\d{2}\b/
  );

  return match ? Number(match[0]) : null;
}

function findYear(obj) {
  if (!obj || typeof obj !== "object") {
    return null;
  }

  const keys = [
    "year",
    "release_year",
    "releaseYear",
    "release_date",
    "releaseDate"
  ];

  for (const key of keys) {
    const year = extractYear(obj[key]);

    if (year) {
      return year;
    }
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

function normalizeWork(work) {
  const tmdbId = findTmdbId(work);

  if (!tmdbId) {
    return null;
  }

  return {
    id: work?.id ?? null,
    tmdb_id: tmdbId,
    title: extractTitle(work),
    year: findYear(work),
    vf_confirmed: true,
    vf_country: "FR",
    source: "DoublageVF",
    confidence: 1,
    status: "confirmed",
    last_verified: new Date().toISOString()
  };
}

async function loadExistingIndex() {
  try {
    const raw = await readFile(
      INDEX_FILE,
      "utf8"
    );

    const data = JSON.parse(raw);

    const items = Array.isArray(data)
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
    const tmdbId = Number(item?.tmdb_id);

    if (
      Number.isInteger(tmdbId) &&
      tmdbId > 0
    ) {
      map.set(tmdbId, item);
    }
  }

  return map;
}

async function fetchPage(page) {
  const skip = (page - 1) * PAGE_SIZE;

  return getJson(
    `/works/browse?skip=${skip}&limit=${PAGE_SIZE}`
  );
}

async function main() {
  console.log("=== Films VF Nuvio - synchronisation ===");
  console.log("Source : DoublageVF");
  console.log("");

  const existingItems =
    await loadExistingIndex();

  const index =
    createIndexMap(existingItems);

  console.log(
    `Index existant : ${index.size} films`
  );

  let scannedWorks = 0;
  let filmWorks = 0;
  let resolved = 0;
  let pagesCompleted = 0;

  for (
    let page = 1;
    page <= MAX_PAGES;
    page++
  ) {
    let payload;

    try {
      payload = await fetchPage(page);
    } catch (error) {
      console.error("");
      console.error(
        `Arrêt propre à la page ${page}: ${error.message}`
      );
      console.error(
        "L'index existant est conservé."
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
        `Page ${page}: aucune œuvre -> fin du scan.`
      );
      break;
    }

    scannedWorks += works.length;

    const films =
      works.filter(isFilm);

    filmWorks += films.length;

    let pageResolved = 0;

    for (const work of films) {
      const item = normalizeWork(work);

      if (!item) {
        console.log(
          `TMDB absent: ${extractTitle(work) || work?.id || "inconnu"}`
        );
        continue;
      }

      const previous =
        index.get(item.tmdb_id);

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

      resolved++;
      pageResolved++;
    }

    pagesCompleted++;

    console.log(
      `Page ${page}/${MAX_PAGES}: ` +
      `${works.length} œuvres, ` +
      `${films.length} films, ` +
      `${pageResolved} TMDB résolus. ` +
      `Index: ${index.size}`
    );

    const pagination =
      payload?.pagination;

    const totalPages = Number(
      pagination?.total_pages ||
      pagination?.pages ||
      pagination?.last_page ||
      0
    );

    if (
      totalPages > 0 &&
      page >= totalPages
    ) {
      break;
    }

    if (works.length < PAGE_SIZE) {
      break;
    }

    await sleep(PAGE_DELAY_MS);
  }

  const items =
    [...index.values()]
      .filter(item => {
        const tmdbId =
          Number(item?.tmdb_id);

        return (
          Number.isInteger(tmdbId) &&
          tmdbId > 0
        );
      })
      .map(item => ({
        id: item?.id || null,
        tmdb_id: Number(item.tmdb_id),
        title: item?.title || null,
        year: item?.year
          ? Number(item.year)
          : null,
        vf_confirmed: true,
        vf_country:
          item?.vf_country || "FR",
        source:
          item?.source || "DoublageVF",
        confidence:
          Number(item?.confidence ?? 1),
        status: "confirmed",
        last_verified:
          item?.last_verified ||
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
  console.log("=== RESULTAT ===");
  console.log(
    `Pages parcourues : ${pagesCompleted}`
  );
  console.log(
    `Œuvres scannées  : ${scannedWorks}`
  );
  console.log(
    `Films trouvés    : ${filmWorks}`
  );
  console.log(
    `TMDB résolus     : ${resolved}`
  );
  console.log(
    `Index final      : ${items.length}`
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
