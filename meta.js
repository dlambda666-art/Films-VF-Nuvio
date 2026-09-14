import { getMovie } from "./tmdb.js";
import { getVFRecord } from "./vf.js";

const IMAGE_BASE = "https://image.tmdb.org/t/p/w500";
const BACKDROP_BASE = "https://image.tmdb.org/t/p/w1280";

export async function buildMeta(id) {
  const match = String(id).match(/^tmdb-(\d+)$/);
  if (!match) return null;

  const tmdbId = Number(match[1]);
  const vf = await getVFRecord(tmdbId);

  if (!vf) return null;

  const movie = await getMovie(tmdbId);
  if (!movie || String(movie.original_language || "").toLowerCase() === "fr") {
    return null;
  }

  return {
    id,
    type: "movie",
    name: movie.title || movie.original_title,
    poster: movie.poster_path ? `${IMAGE_BASE}${movie.poster_path}` : undefined,
    background: movie.backdrop_path
      ? `${BACKDROP_BASE}${movie.backdrop_path}`
      : undefined,
    description: movie.overview || "",
    releaseInfo: movie.release_date || "",
    imdbRating: movie.vote_average || undefined,
    genres: (movie.genres || []).map(g => g.name),
    posterShape: "poster",
    meta: {
      tmdb_id: movie.id,
      original_title: movie.original_title,
      vf: true,
      vf_country: vf.vf_country || null,
      vf_source: vf.source || null,
      vf_verified: true
    }
  };
}
