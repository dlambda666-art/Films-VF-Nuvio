import { getMovie } from "./tmdb.js";
import { CONFIG } from "./config.js";
import { getVerifiedVFIds, getVFRecord } from "./vf.js";

const IMAGE_BASE = "https://image.tmdb.org/t/p/w500";
const BACKDROP_BASE = "https://image.tmdb.org/t/p/w1280";

const CACHE_TTL = 15 * 60 * 1000;
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
  return String(movie?.original_language || "").toLowerCase() !== "fr";
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

function getYear(movie, vfRecord) {
  const movieYear = Number(
    String(movie?.release_date || "").slice(0, 4)
  );

  const vfYear = Number(vfRecord?.year || 0);

  if (movieYear >= 1900) return movieYear;
  if (vfYear >= 1900) return vfYear;

  return 0;
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

/*
 * Classement général :
 *
 * 1. Films récents fortement privilégiés
 * 2. Popularité
 * 3. Nombre de votes
 * 4. Note
 *
 * Les anciens films restent possibles si la VF existe,
 * mais ils passent derrière les films récents.
 */
function score(movie, vfRecord) {
  const year = getYear(movie, vfRecord);

  let yearBonus = 0;

  if (year === 2026) {
    yearBonus = 1400;
  } else if (year === 2025) {
    yearBonus = 1100;
  } else if (year === 2024) {
    yearBonus = 800;
  } else if (year === 2023) {
    yearBonus = 550;
  } else if (year === 2022) {
    yearBonus = 350;
  } else if (year === 2021) {
    yearBonus = 200;
  } else if (year >= 2018) {
    yearBonus = 100;
  }

  const popularity = Math.min(
    Number(movie.popularity || 0) * 5,
    650
  );

  const rating =
    Number(movie.vote_average || 0) * 12;

  const votes =
    Number(movie.vote_count || 0);

  let voteBonus = 0;

  if (votes >= 20000) {
    voteBonus = 220;
  } else if (votes >= 10000) {
    voteBonus = 180;
  } else if (votes >= 5000) {
    voteBonus = 130;
  } else if (votes >= 2000) {
    voteBonus = 80;
  } else if (votes >= 1000) {
    voteBonus = 40;
  }

  return (
    yearBonus +
    popularity +
    rating +
    voteBonus
  );
}

function releaseTimestamp(movie) {
  const date = String(movie?.release_date || "");

  const timestamp = Date.parse(date);

  return Number.isNaN(timestamp) ? 0 : timestamp;
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
        vfRecord?.source || "DoublageVF",
      vf_verified: true
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

/*
 * Nouveautés :
 *
 * On utilise l'année du film, pas last_verified.
 *
 * last_verified = date de vérification de la base,
 * PAS date de sortie VF.
 *
 * Donc on ne triche jamais en considérant une vérification
 * comme une nouvelle sortie VF.
 */
function sortRecent(a, b) {
  const yearA =
    getYear(a.movie, a.vfRecord);

  const yearB =
    getYear(b.movie, b.vfRecord);

  if (yearB !== yearA) {
    return yearB - yearA;
  }

  const dateB =
    releaseTimestamp(b.movie);

  const dateA =
    releaseTimestamp(a.movie);

  if (dateB !== dateA) {
    return dateB - dateA;
  }

  return (
    score(b.movie, b.vfRecord) -
    score(a.movie, a.vfRecord)
  );
}

/*
 * Classement des genres :
 * priorité aux films récents ET populaires.
 */
function sortGenre(a, b) {
  const scoreA =
    score(a.movie, a.vfRecord);

  const scoreB =
    score(b.movie, b.vfRecord);

  if (scoreB !== scoreA) {
    return scoreB - scoreA;
  }

  return (
    releaseTimestamp(b.movie) -
    releaseTimestamp(a.movie)
  );
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

  /*
   * Recharge périodiquement l'index VF.
   *
   * Cela permet au catalogue de rester vivant :
   * nouveau film ajouté au vf-index.json =
   * nouveau film potentiellement visible ici.
   */
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
   *
   * Important :
   * on ne prétend pas qu'un vieux film est "VF 2026"
   * simplement parce qu'il vient d'être vérifié.
   *
   * Seuls les films 2026 sont donc affichés ici.
   */
  if (
    catalogId ===
    "nouveautes-vf-2026"
  ) {
    filtered =
      enriched.filter(
        ({ movie, vfRecord }) =>
          getYear(movie, vfRecord) === 2026
      );

    filtered.sort(sortRecent);
  }

  /*
   * VF 2025
   */
  else if (
    catalogId === "vf-2025"
  ) {
    filtered =
      enriched.filter(
        ({ movie, vfRecord }) =>
          getYear(movie, vfRecord) === 2025
      );

    filtered.sort(sortRecent);
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
            getGenreIds(movie).includes(
              Number(genreId)
            )
        );
    }

    filtered.sort(sortGenre);
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
