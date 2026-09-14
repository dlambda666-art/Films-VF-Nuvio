import { getMovie } from "./tmdb.js";
import { CONFIG } from "./config.js";
import { getVerifiedVFIds, getVFRecord } from "./vf.js";

const IMAGE_BASE = "https://image.tmdb.org/t/p/w500";
const BACKDROP_BASE = "https://image.tmdb.org/t/p/w1280";

const CACHE_TTL = 30 * 60 * 1000;
const DETAILS_BATCH = 20;

let catalogCache = new Map();
let detailsCache = new Map();
let indexCache = null;
let indexCacheTime = 0;

const EXCLUDED_GENRES = new Set([
  18,    // Drame
  35,    // Comédie
  10749, // Romance
  10751, // Famille
  16,    // Animation
  99,    // Documentaire
  10402, // Musique
  10770  // Téléfilm
]);

function isForeign(movie) {
  return String(
    movie?.original_language || ""
  ).toLowerCase() !== "fr";
}

function getGenreIds(movie) {
  if (Array.isArray(movie?.genre_ids)) {
    return movie.genre_ids.map(Number);
  }

  if (Array.isArray(movie?.genres)) {
    return movie.genres
      .map(g => Number(g?.id))
      .filter(Number.isInteger);
  }

  return [];
}

function isAllowed(movie) {
  if (!movie?.id) return false;

  if (!isForeign(movie)) return false;

  const genreIds = getGenreIds(movie);

  if (genreIds.some(id => EXCLUDED_GENRES.has(id))) {
    return false;
  }

  return true;
}

function score(movie) {
  const popularity = Math.min(
    Number(movie.popularity || 0) * 4,
    500
  );

  const rating =
    Number(movie.vote_average || 0) * 10;

  const votes =
    Number(movie.vote_count || 0);

  let voteBonus = 0;

  if (votes >= 10000) {
    voteBonus = 150;
  } else if (votes >= 5000) {
    voteBonus = 100;
  } else if (votes >= 1000) {
    voteBonus = 50;
  }

  return popularity + rating + voteBonus;
}

function toMeta(movie, vfRecord) {
  return {
    id: `tmdb-${movie.id}`,
    type: "movie",
    name:
      movie.title ||
      movie.original_title,

    poster: movie.poster_path
      ? `${IMAGE_BASE}${movie.poster_path}`
      : undefined,

    background: movie.backdrop_path
      ? `${BACKDROP_BASE}${movie.backdrop_path}`
      : undefined,

    description:
      movie.overview || "",

    releaseInfo:
      movie.release_date || "",

    imdbRating:
      movie.vote_average || undefined,

    genres:
      Array.isArray(movie.genres)
        ? movie.genres.map(g => g.name)
        : [],

    posterShape: "poster",

    meta: {
      tmdb_id: movie.id,
      vf: true,
      vf_country:
        vfRecord?.vf_country || "FR",
      vf_source:
        vfRecord?.source || "DoublageVF"
    }
  };
}

async function loadVFIndex() {
  if (
    indexCache &&
    Date.now() - indexCacheTime < CACHE_TTL
  ) {
    return indexCache;
  }

  const ids =
    await getVerifiedVFIds();

  const records = [];

  for (const id of ids) {
    const record =
      await getVFRecord(id);

    if (record) {
      records.push(record);
    }
  }

  indexCache = records;
  indexCacheTime = Date.now();

  return records;
}

async function getMovieDetails(tmdbId) {
  if (detailsCache.has(tmdbId)) {
    return detailsCache.get(tmdbId);
  }

  try {
    const movie =
      await getMovie(tmdbId);

    if (movie) {
      detailsCache.set(
        tmdbId,
        movie
      );
    }

    return movie;
  } catch (error) {
    console.error(
      `TMDB details ${tmdbId}:`,
      error.message
    );

    return null;
  }
}

async function enrichRecords(records) {
  const result = [];

  for (
    let i = 0;
    i < records.length;
    i += DETAILS_BATCH
  ) {
    const batch =
      records.slice(
        i,
        i + DETAILS_BATCH
      );

    const movies =
      await Promise.all(
        batch.map(record =>
          getMovieDetails(
            record.tmdb_id
          )
        )
      );

    for (
      let j = 0;
      j < movies.length;
      j++
    ) {
      const movie = movies[j];

      if (!movie) continue;

      if (!isAllowed(movie)) {
        continue;
      }

      result.push({
        movie,
        vfRecord: batch[j]
      });
    }
  }

  return result;
}

function sortNewest(a, b) {
  const dateA =
    a.movie.release_date || "";

  const dateB =
    b.movie.release_date || "";

  return dateB.localeCompare(dateA);
}

export async function buildCatalog(catalogId) {
  const cached =
    catalogCache.get(catalogId);

  if (
    cached &&
    Date.now() - cached.time < CACHE_TTL
  ) {
    return cached.items;
  }

  const records =
    await loadVFIndex();

  if (!records.length) {
    return [];
  }

  const enriched =
    await enrichRecords(records);

  let filtered = enriched;

  /*
   * NOUVEAUTÉS VF 2026
   */
  if (
    catalogId ===
    "nouveautes-vf-2026"
  ) {
    filtered =
      enriched.filter(
        ({ movie, vfRecord }) => {

          const movieYear =
            String(
              movie.release_date || ""
            ).slice(0, 4);

          const vfYear =
            String(
              vfRecord?.year || ""
            );

          return (
            movieYear === "2026" ||
            vfYear === "2026"
          );
        }
      );

    filtered.sort(
      (a, b) => {

        const yearA =
          Number(
            a.vfRecord?.year ||
            String(
              a.movie.release_date ||
              ""
            ).slice(0, 4) ||
            0
          );

        const yearB =
          Number(
            b.vfRecord?.year ||
            String(
              b.movie.release_date ||
              ""
            ).slice(0, 4) ||
            0
          );

        if (yearB !== yearA) {
          return yearB - yearA;
        }

        return sortNewest(a, b);
      }
    );
  }

  /*
   * VF 2025
   */
  else if (
    catalogId === "vf-2025"
  ) {
    filtered =
      enriched.filter(
        ({ movie, vfRecord }) => {

          const movieYear =
            String(
              movie.release_date || ""
            ).slice(0, 4);

          const vfYear =
            String(
              vfRecord?.year || ""
            );

          return (
            movieYear === "2025" ||
            vfYear === "2025"
          );
        }
      );

    filtered.sort(
      (a, b) => {

        const yearA =
          Number(
            a.vfRecord?.year ||
            String(
              a.movie.release_date ||
              ""
            ).slice(0, 4) ||
            0
          );

        const yearB =
          Number(
            b.vfRecord?.year ||
            String(
              b.movie.release_date ||
              ""
            ).slice(0, 4) ||
            0
          );

        if (yearB !== yearA) {
          return yearB - yearA;
        }

        return sortNewest(a, b);
      }
    );
  }

  /*
   * CATALOGUES PAR GENRE
   */
  else {
    const genreId =
      CONFIG.genreMap[catalogId];

    if (genreId) {
      filtered =
        enriched.filter(
          ({ movie }) =>
            getGenreIds(movie)
              .includes(
                Number(genreId)
              )
        );
    }

    filtered.sort(
      (a, b) =>
        score(b.movie) -
        score(a.movie)
    );
  }

  const items =
    filtered
      .slice(
        0,
        CONFIG.maxResults
      )
      .map(
        ({ movie, vfRecord }) =>
          toMeta(
            movie,
            vfRecord
          )
      );

  catalogCache.set(
    catalogId,
    {
      time: Date.now(),
      items
    }
  );

  return items;
}
