import { getMovie } from "./tmdb.js";
import { CONFIG } from "./config.js";
import { getVerifiedVFIds, getVFRecord } from "./vf.js";

const IMAGE_BASE = "https://image.tmdb.org/t/p/w500";
const BACKDROP_BASE = "https://image.tmdb.org/t/p/w1280";

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
    return movie.genre_ids;
  }

  if (Array.isArray(movie.genres)) {
    return movie.genres.map((g) => g.id);
  }

  return [];
}

function scoreMovie(movie, vfRecord) {
  const year = getYear(movie, vfRecord);
  const currentYear = new Date().getFullYear();

  let score = 0;

  if (year === currentYear) score += 1000;
  else if (year === currentYear - 1) score += 400;

  if (movie.popularity) {
    score += Math.min(movie.popularity * 4, 500);
  }

  if (movie.vote_average) {
    score += movie.vote_average * 10;
  }

  if (movie.vote_count >= 1000) score += 150;
  else if (movie.vote_count >= 500) score += 100;
  else if (movie.vote_count >= 100) score += 50;

  return score;
}

function toMeta(movie, vfRecord) {
  return {
    id: `tmdb:${movie.id}`,
    type: "movie",
    name: movie.title || movie.original_title,
    poster: movie.poster_path
      ? `${IMAGE_BASE}${movie.poster_path}`
      : undefined,
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
      vf: true,
      vf_country: vfRecord?.vf_country || "FR",
      vf_source: vfRecord?.source || "DoublageVF",
      vf_verified: true
    }
  };
}

export async function buildCatalog(catalogId) {
  const verifiedIds = await getVerifiedVFIds();

  if (!verifiedIds.size) {
    return [];
  }

  const results = [];

  for (const tmdbId of verifiedIds) {
    try {
      const movie = await getMovie(tmdbId);

      if (!movie) continue;

      // Films étrangers uniquement
      if (
        String(movie.original_language || "").toLowerCase() === "fr"
      ) {
        continue;
      }

      const genres = getGenres(movie);

      // Genres exclus
      if (
        genres.some((genreId) =>
          CONFIG.excludedMovieGenres.has(Number(genreId))
        )
      ) {
        continue;
      }

      // Horreur VF
      if (catalogId === "horreur" && !genres.includes(27)) {
        continue;
      }

      const vfRecord = await getVFRecord(tmdbId);
      const year = getYear(movie, vfRecord);
      const currentYear = new Date().getFullYear();

      // Nouveautés VF = année courante
      if (catalogId === "nouveautes-vf" && year !== currentYear) {
        continue;
      }

      results.push({
        movie,
        vfRecord,
        score: scoreMovie(movie, vfRecord)
      });
    } catch (error) {
      console.error(`Movie ${tmdbId} error:`, error);
    }
  }

  results.sort((a, b) => b.score - a.score);

  return results
    .slice(0, CONFIG.maxResults)
    .map(({ movie, vfRecord }) => toMeta(movie, vfRecord));
}
