import { discoverMovies } from "./tmdb.js";
import { CONFIG } from "./config.js";
import { getVerifiedVFIds, getVFRecord } from "./vf.js";

const IMAGE_BASE = "https://image.tmdb.org/t/p/w500";
const BACKDROP_BASE = "https://image.tmdb.org/t/p/w1280";

const CANDIDATE_CACHE_TTL = 15 * 60 * 1000;
const DISCOVER_PAGES = Math.max(Number(CONFIG.tmdbPages || 8), 20);

let candidateCache = null;
let candidateCacheTime = 0;

function isForeign(movie) {
  return String(movie.original_language || "").toLowerCase() !== "fr";
}

function score(movie) {
  const popularity = Math.min(Number(movie.popularity || 0) * 4, 500);
  const rating = Number(movie.vote_average || 0) * 10;
  const votes = Number(movie.vote_count || 0);

  let voteBonus = 0;
  if (votes >= 10000) voteBonus = 150;
  else if (votes >= 5000) voteBonus = 100;
  else if (votes >= 1000) voteBonus = 50;

  return popularity + rating + voteBonus;
}

function toMeta(movie, vfRecord) {
  return {
    id: `tmdb-${movie.id}`,
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
    posterShape: "poster",
    meta: {
      tmdb_id: movie.id,
      vf: true,
      vf_country: vfRecord?.vf_country || null,
      vf_source: vfRecord?.source || null
    }
  };
}

async function fetchDiscoverPages(sortBy, today) {
  const requests = [];

  for (let page = 1; page <= DISCOVER_PAGES; page++) {
    requests.push(
      discoverMovies({
        page,
        sort_by: sortBy,
        without_genres: [...CONFIG.excludedMovieGenres].join(","),
        "primary_release_date.lte": today
      })
    );
  }

  return Promise.all(requests);
}

async function getCandidates() {
  if (
    candidateCache &&
    Date.now() - candidateCacheTime < CANDIDATE_CACHE_TTL
  ) {
    return candidateCache;
  }

  const today = new Date().toISOString().slice(0, 10);

  const [releasePages, popularPages] = await Promise.all([
    fetchDiscoverPages("primary_release_date.desc", today),
    fetchDiscoverPages("popularity.desc", today)
  ]);

  const unique = new Map();

  for (const page of [...releasePages, ...popularPages]) {
    for (const movie of page.results || []) {
      if (!movie?.id || !isForeign(movie)) continue;

      if (
        (movie.genre_ids || []).some(id =>
          CONFIG.excludedMovieGenres.has(id)
        )
      ) {
        continue;
      }

      unique.set(movie.id, movie);
    }
  }

  candidateCache = [...unique.values()];
  candidateCacheTime = Date.now();

  return candidateCache;
}

export async function buildCatalog(catalogId) {
  const vfIds = await getVerifiedVFIds();
  if (!vfIds.size) return [];

  const candidates = await getCandidates();
  const genreId = CONFIG.genreMap[catalogId];
  const ranked = [];

  for (const movie of candidates) {
    if (!vfIds.has(movie.id)) continue;

    if (
      genreId &&
      !(movie.genre_ids || []).includes(genreId)
    ) {
      continue;
    }

    const year = String(movie.release_date || "").slice(0, 4);

    if (
      catalogId === "nouveautes-vf-2026" &&
      year !== "2026"
    ) {
      continue;
    }

    if (
      catalogId === "vf-2025" &&
      year !== "2025"
    ) {
      continue;
    }

    const vfRecord = await getVFRecord(movie.id);

    ranked.push({
      movie,
      vfRecord,
      rank: score(movie)
    });
  }

  ranked.sort((a, b) => {
    const dateA = a.movie.release_date || "";
    const dateB = b.movie.release_date || "";

    if (
      catalogId === "nouveautes-vf-2026" ||
      catalogId === "vf-2025"
    ) {
      if (dateA !== dateB) {
        return dateB.localeCompare(dateA);
      }
    }

    return b.rank - a.rank;
  });

  return ranked
    .slice(0, CONFIG.maxResults)
    .map(({ movie, vfRecord }) =>
      toMeta(movie, vfRecord)
    );
}
