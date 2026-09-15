import { getMovie } from "./tmdb.js";
import { CONFIG } from "./config.js";
import { getVerifiedVFIds, getVFRecord } from "./vf.js";

const IMAGE_BASE = "https://image.tmdb.org/t/p/w500";
const BACKDROP_BASE = "https://image.tmdb.org/t/p/w1280";
const BETTERPOSTER_BASE =
  "https://btttr.cc/poster-qa/imdb/poster-default";

/*
 * Cache TMDB :
 * garde les fiches déjà récupérées pendant 10 minutes.
 */
const MOVIE_CACHE_TTL = 10 * 60 * 1000;
const movieCache = new Map();

/*
 * Requêtes TMDB actuellement en cours.
 * Cela évite que deux catalogues demandent
 * le même film en même temps.
 */
const moviePending = new Map();

/*
 * Cache des catalogues construits.
 * Une fois le catalogue construit, Nuvio
 * récupère directement le résultat pendant 15 minutes.
 */
const CATALOG_CACHE_TTL = 15 * 60 * 1000;
const catalogCache = new Map();

/*
 * Construction actuellement en cours par catalogue.
 * Si Nuvio fait deux demandes identiques simultanément,
 * une seule construction est effectuée.
 */
const catalogPending = new Map();

async function getCachedMovie(tmdbId) {
  const cached = movieCache.get(tmdbId);

  if (cached && Date.now() - cached.time < MOVIE_CACHE_TTL) {
    return cached.movie;
  }

  const pending = moviePending.get(tmdbId);

  if (pending) {
    return pending;
  }

  const request = (async () => {
    try {
      const movie = await getMovie(tmdbId);

      movieCache.set(tmdbId, {
        movie,
        time: Date.now()
      });

      return movie;
    } catch (error) {
      movieCache.delete(tmdbId);
      throw error;
    } finally {
      moviePending.delete(tmdbId);
    }
  })();

  moviePending.set(tmdbId, request);

  return request;
}

function getYear(movie, vfRecord) {
  if (movie.release_date) {
    return Number(movie.release_date.slice(0, 4));
  }

  if (vfRecord?.year) {
    return Number(vfRecord.year);
  }

  return 0;
}

function getGenres(movie) {
  if (Array.isArray(movie.genre_ids)) {
    return movie.genre_ids.map(Number);
  }

  if (Array.isArray(movie.genres)) {
    return movie.genres.map((g) => Number(g.id));
  }

  return [];
}

function scoreMovie(movie, vfRecord) {
  const year = getYear(movie, vfRecord);
  const currentYear = new Date().getFullYear();

  let score = 0;

  if (year === currentYear) {
    score += 1000;
  } else if (year === currentYear - 1) {
    score += 400;
  }

  if (movie.popularity) {
    score += Math.min(movie.popularity * 4, 500);
  }

  if (movie.vote_average) {
    score += movie.vote_average * 10;
  }

  if (movie.vote_count >= 1000) {
    score += 150;
  } else if (movie.vote_count >= 500) {
    score += 100;
  } else if (movie.vote_count >= 100) {
    score += 50;
  }

  return score;
}

function getPoster(movie) {
  const imdbId = movie.imdb_id || null;

  if (imdbId) {
    return `${BETTERPOSTER_BASE}/${encodeURIComponent(imdbId)}.jpg?lang=fr`;
  }

  if (movie.poster_path) {
    return `${IMAGE_BASE}${movie.poster_path}`;
  }

  return undefined;
}

function toMeta(movie, vfRecord) {
  return {
    id: `tmdb:${movie.id}`,
    type: "movie",
    name: movie.title || movie.original_title,

    poster: getPoster(movie),

    background: movie.backdrop_path
      ? `${BACKDROP_BASE}${movie.backdrop_path}`
      : undefined,

    description: movie.overview || "",
    releaseInfo: movie.release_date || "",
    imdbRating: movie.vote_average || undefined,

    genres: Array.isArray(movie.genres)
      ? movie.genres.map((g) => g.name)
      : [],

    posterShape: "poster",

    meta: {
      tmdb_id: movie.id,
      imdb_id: movie.imdb_id || null,
      original_title: movie.original_title,
      vf: true,
      vf_country: vfRecord?.vf_country || "FR",
      vf_source: vfRecord?.source || "DoublageVF",
      vf_verified: true
    }
  };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex++;

      if (index >= items.length) {
        return;
      }

      try {
        results[index] = await mapper(items[index], index);
      } catch (error) {
        console.error(`Item ${items[index]} error:`, error);
        results[index] = null;
      }
    }
  }

  const workers = Math.min(concurrency, items.length);

  await Promise.all(
    Array.from({ length: workers }, () => worker())
  );

  return results;
}

async function buildCatalogInternal(catalogId) {
  const verifiedIds = await getVerifiedVFIds();

  if (!verifiedIds.size) {
    return [];
  }

  const ids = [...verifiedIds];

  /*
   * 15 appels simultanés :
   * suffisamment rapide pour le démarrage,
   * sans lancer une rafale énorme vers TMDB.
   */
  const processed = await mapWithConcurrency(
    ids,
    15,
    async (tmdbId) => {
      const movie = await getCachedMovie(tmdbId);

      if (!movie) {
        return null;
      }

      // Films étrangers uniquement
      if (
        String(movie.original_language || "").toLowerCase() === "fr"
      ) {
        return null;
      }

      const genres = getGenres(movie);

      // Genres exclus
      if (
        genres.some((genreId) =>
          CONFIG.excludedMovieGenres.has(Number(genreId))
        )
      ) {
        return null;
      }

      // Horreur VF
      if (
        catalogId === "horreur" &&
        !genres.includes(27)
      ) {
        return null;
      }

      const vfRecord = await getVFRecord(tmdbId);

      const year = getYear(movie, vfRecord);
      const currentYear = new Date().getFullYear();

      // Nouveautés VF = année courante
      if (
        catalogId === "nouveautes-vf" &&
        year !== currentYear
      ) {
        return null;
      }

      return {
        movie,
        vfRecord,
        score: scoreMovie(movie, vfRecord)
      };
    }
  );

  const results = processed.filter(Boolean);

  results.sort((a, b) => b.score - a.score);

  /*
   * Aucun nombre maximum artificiel.
   * Tous les films admissibles sont conservés.
   */
  return results.map(({ movie, vfRecord }) =>
    toMeta(movie, vfRecord)
  );
}

export async function buildCatalog(catalogId) {
  /*
   * 1. Si le catalogue est déjà construit récemment,
   *    on le renvoie immédiatement.
   */
  const cached = catalogCache.get(catalogId);

  if (
    cached &&
    Date.now() - cached.time < CATALOG_CACHE_TTL
  ) {
    return cached.metas;
  }

  /*
   * 2. Si une construction est déjà en cours,
   *    on attend celle-ci au lieu d'en lancer une deuxième.
   */
  const pending = catalogPending.get(catalogId);

  if (pending) {
    return pending;
  }

  /*
   * 3. Construction unique du catalogue.
   */
  const request = (async () => {
    try {
      const metas = await buildCatalogInternal(catalogId);

      catalogCache.set(catalogId, {
        metas,
        time: Date.now()
      });

      return metas;
    } catch (error) {
      console.error(`Catalog ${catalogId} error:`, error);
      throw error;
    } finally {
      catalogPending.delete(catalogId);
    }
  })();

  catalogPending.set(catalogId, request);

  return request;
}
