loimport { readFile, writeFile } from "node:fs/promises";

const BASE = "https://doublagevf.fr/api";
const INDEX_FILE = "vf-index.json";

const PAGE_SIZE = Number(process.env.PAGE_SIZE || 50);
const MAX_PAGES = Number(process.env.MAX_PAGES || 428);

// DoublageVF limite rapidement les requêtes.
// On reste volontairement très prudent.
const CONCURRENCY = Number(process.env.CONCURRENCY || 2);
const REQUEST_DELAY_MS = Number(process.env.REQUEST_DELAY_MS || 1200);

const MAX_RETRIES = 6;
const RETRY_BASE_MS = 5000;

const FULL_SYNC = process.env.FULL_SYNC === "1";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function getJson(path, attempt = 0) {
  const response = await fetch(`${BASE}${path}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Films-VF-Nuvio/1.0"
    }
  });

  if (response.ok) {
    return response.json();
  }

  const retryable =
    response.status === 429 ||
    response.status === 500 ||
    response.status === 502 ||
    response.status === 503 ||
    response.status === 504;

  if (retryable && attempt < MAX_RETRIES) {
    const retryAfter = Number(
      response.headers.get("retry-after")
    );

    const wait =
      Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : RETRY_BASE_MS * Math.pow(2, attempt);

    console.log(
      `HTTP ${response.status} sur ${path} → attente ${Math.round(
        wait / 1000
      )}s puis nouvelle tentative (${attempt + 1}/${MAX_RETRIES})`
    );

    await sleep(wait);

    return getJson(path, attempt + 1);
  }

  throw new Error(`${response.status} ${path}`);
}

async function fetchBrowsePage(page) {
  const skip = (page - 1) * PAGE_SIZE;

  return getJson(
    `/works/browse?skip=${skip}&limit=${PAGE_SIZE}`
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

function extractYear(value) {
  if (value == null) return null;

  const match = String(value).match(/\b(?:19|20)\d{2}\b/);

  return match ? Number(match[0]) : null;
}

function findYear(obj) {
  if (!obj || typeof obj !== "object") return null;

  const keys = [
    "year",
    "release_year",
    "releaseYear",
    "release_date",
    "releaseDate",
    "date"
  ];

  for (const key of keys) {
    const year = extractYear(obj[key]);

    if (year) return year;
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      const year = findYear(value);

      if (year) return year;
    }
  }

  return null;
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
    const match = value.match(
      /(?:movie[/:]|themoviedb\.org\/movie\/)(\d+)/i
    );

    if (match) return Number(match[1]);

    if (/^\d+$/.test(value)) {
      return Number(value);
    }
  }

  return null;
}

function findTmdbId(obj) {
  if (!obj || typeof obj !== "object") return null;

  const directKeys = [
    "tmdb_id",
    "tmdbId",
    "tmdb",
    "tmdb_movie_id",
    "external_id",
    "externalId",
    "tmdb_url"
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
  const directId = findTmdbId(work);

  if (directId) {
    return {
      tmdbId: directId,
      year: findYear(work)
    };
  }

  // Fiche complète DoublageVF
  for (const route of [
    `/work/${encodeURIComponent(work.id)}`,
    `/works/${encodeURIComponent(work.id)}`
  ]) {
    try {
      const detail = await getJson(route);

      const tmdbId = findTmdbId(detail);

      const year =
        findYear(detail) ||
        findYear(work);

      if (tmdbId) {
        return {
          tmdbId,
          year
        };
      }
    } catch {}
  }

  // Dernier recours : recherche universelle
  if (!work.title) return null;

  try {
    const q = encodeURIComponent(work.title);

    const data = await getJson(
      `/search/universal?q=${q}`
    );

    const works = Array.isArray(data?.works)
      ? data.works
      : [];

    const filmWorks = works.filter(x =>
      String(
        x?.work_type ||
        x?.type ||
        ""
      ).toUpperCase() === "FILM"
    );

    if (!filmWorks.length) return null;

    const title = String(work.title)
      .trim()
      .toLowerCase();

    const exact = filmWorks.filter(x =>
      String(x?.title || "")
        .trim()
        .toLowerCase() === title
    );

    const pool = exact.length
      ? exact
      : filmWorks;

    const sourceYear = findYear(work);

    if (sourceYear) {
      const sameYear = pool.find(
        x => findYear(x) === sourceYear
      );

      if (sameYear) {
        const tmdbId = findTmdbId(sameYear);

        if (tmdbId) {
          return {
            tmdbId,
            year: sourceYear
          };
        }
      }
    }

    const candidate = pool.find(
      x => findTmdbId(x)
    );

    if (!candidate) return null;

    return {
      tmdbId: findTmdbId(candidate),
      year:
        findYear(candidate) ||
        sourceYear ||
        null
    };
  } catch {
    return null;
  }
}

async function mapWithConcurrency(
  items,
  worker,
  concurrency
) {
  const results = new Array(items.length);

  let cursor = 0;

  async function run() {
    while (true) {
      const index = cursor++;

      if (index >= items.length) {
        return;
      }

      results[index] = await worker(
        items[index],
        index
      );

      if (REQUEST_DELAY_MS) {
        await sleep(REQUEST_DELAY_MS);
      }
    }
  }

  await Promise.all(
    Array.from(
      {
        length: Math.min(
          concurrency,
          items.length
        )
      },
      run
    )
  );

  return results;
}

async function loadExisting() {
  try {
    const raw = await readFile(
      INDEX_FILE,
      "utf8"
    );

    const data = JSON.parse(raw);

    const items = Array.isArray(data)
      ? data
      : data.items;

    return Array.isArray(items)
      ? items
      : [];
  } catch {
    return [];
  }
}

async function main() {
  const existingItems =
    await loadExisting();

  const byTmdb = new Map(
    existingItems
      .filter(x =>
        Number.isInteger(
          Number(x?.tmdb_id)
        )
      )
      .map(x => [
        Number(x.tmdb_id),
        x
      ])
  );

  const pages = FULL_SYNC
    ? MAX_PAGES
    : 8;

  let scannedWorks = 0;
  let filmWorks = 0;
  let resolved = 0;

  for (
    let page = 1;
    page <= pages;
    page++
  ) {
    let payload;

    try {
      payload =
        await fetchBrowsePage(page);
    } catch (error) {
      console.error(
        `Page ${page} failed:`,
        error.message
      );

      // On arrête plutôt que de continuer
      // à marteler DoublageVF après un rate-limit.
      if (
        String(error.message).startsWith("429")
      ) {
        console.error(
          "Rate-limit DoublageVF persistant. " +
          "Le prochain run pourra reprendre."
        );

        break;
      }

      continue;
    }

    const works =
      Array.isArray(payload?.works)
        ? payload.works
        : [];

    if (!works.length) break;

    scannedWorks += works.length;

    const films =
      works.filter(isFilm);

    filmWorks += films.length;

    const resolvedPage =
      await mapWithConcurrency(
        films,
        async work => {
          const result =
            await resolveTmdb(work);

          if (!result?.tmdbId) {
            console.log(
              `TMDB introuvable: ${work.title}`
            );

            return null;
          }

          resolved++;

          return {
            id: work.id,
            tmdb_id: result.tmdbId,
            title:
              work.title || null,
            year:
              result.year || null,
            vf_confirmed: true,
            vf_country: "FR",
            source: "DoublageVF",
            confidence: 1,
            status: "confirmed",
            last_verified:
              new Date().toISOString()
          };
        },
        CONCURRENCY
      );

    for (const item of resolvedPage) {
      if (!item) continue;

      const previous =
        byTmdb.get(item.tmdb_id);

      byTmdb.set(
        item.tmdb_id,
        {
          ...previous,
          ...item,
          year:
            item.year ||
            previous?.year ||
            null
        }
      );
    }

    console.log(
      `Page ${page}/${pages}: ` +
      `${works.length} œuvres, ` +
      `${films.length} films, ` +
      `${resolvedPage.filter(Boolean).length} TMDB résolus.`
    );

    const pagination =
      payload?.pagination;

    if (pagination) {
      const totalPages =
        Number(
          pagination.total_pages
        ) ||
        Number(
          pagination.pages
        ) ||
        Number(
          pagination.last_page
        );

      if (
        Number.isFinite(totalPages) &&
        page >= totalPages
      ) {
        break;
      }
    }

    if (works.length < PAGE_SIZE) {
      break;
    }

    // Pause supplémentaire entre les pages.
    await sleep(REQUEST_DELAY_MS);
  }

  const items =
    [...byTmdb.values()]
      .filter(x =>
        Number.isInteger(
          Number(x?.tmdb_id)
        ) &&
        Number(x.tmdb_id) > 0
      )
      .map(x => ({
        id: x.id || null,
        tmdb_id: Number(x.tmdb_id),
        title: x.title || null,
        year:
          x.year
            ? Number(x.year)
            : null,
        vf_confirmed: true,
        vf_country:
          x.vf_country || "FR",
        source:
          x.source || "DoublageVF",
        confidence:
          Number(x.confidence ?? 1),
        status: "confirmed",
        last_verified:
          x.last_verified ||
          new Date().toISOString()
      }))
      .sort((a, b) => {
        const ay =
          Number(a.year || 0);

        const by =
          Number(b.year || 0);

        return (
          by - ay ||
          String(a.title || "")
            .localeCompare(
              String(b.title || "")
            )
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
    `Œuvres scannées : ${scannedWorks}`
  );

  console.log(
    `Films trouvés   : ${filmWorks}`
  );

  console.log(
    `TMDB résolus    : ${resolved}`
  );

  console.log(
    `Index final     : ${items.length}`
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
