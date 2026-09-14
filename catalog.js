import { discoverMovies } from "./tmdb.js";
import { CONFIG } from "./config.js";
import { getVerifiedVFIds, getVFRecord } from "./vf.js";

const IMAGE_BASE = "https://image.tmdb.org/t/p/w500";
const BACKDROP_BASE = "https://image.tmdb.org/t/p/w1280";

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
    poster: movie.poster_path ? `${IMAGE_BASE}${movie.poster_path}` : undefined,
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

async function getCandidates() {
  const requests = [];

  for (let page = 1; page <= CONFIG.tmdbPages; page++) {
    requests.push(
      discoverMovies({
        page,
        without_genres: [...CONFIG.excludedMovieGenres].join(",")
      })
    );
  }

  const pages = await Promise.all(requests);
  const unique = new Map();

  for (const page of pages) {
    for (const movie of page.results || []) {
      if (!movie?.id || !isForeign(movie)) continue;
      if ((movie.genre_ids || []).some(id => CONFIG.excludedMovieGenres.has(id))) continue;
      unique.set(movie.id, movie);
    }
  }

  return [...unique.values()];
}

export async function buildCatalog(catalogId) {
  const vfIds = await getVerifiedVFIds();
  if (!vfIds.size) return [];

  const candidates = await getCandidates();
  const ranked = [];

  for (const movie of candidates) {
    if (!vfIds.has(movie.id)) continue;

    const genreId = CONFIG.genreMap[catalogId];
    if (genreId && !(movie.genre_ids || []).includes(genreId)) continue;

    const year = String(movie.release_date || "").slice(0, 4);
    if (catalogId === "nouveautes-vf-2026" && year !== "2026") continue;
    if (catalogId === "vf-2025" && year !== "2025") continue;

    ranked.push({
      movie,
      vfRecord: await getVFRecord(movie.id),
      rank: score(movie)
    });
  }

  ranked.sort((a, b) => b.rank - a.rank);

  return ranked
    .slice(0, CONFIG.maxResults)
    .map(({ movie, vfRecord }) => toMeta(movie, vfRecord));
}
