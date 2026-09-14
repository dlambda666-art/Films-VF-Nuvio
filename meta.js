import { getMovie } from "./tmdb.js";
import { getVFRecord } from "./vf.js";

const BACKDROP_BASE = "https://image.tmdb.org/t/p/w1280";
const BETTERPOSTER_BASE =
  "https://btttr.cc/poster-qa/imdb/poster-default";

export async function buildMeta(id) {
  const match = String(id).match(/^tmdb:(\d+)$/);

  if (!match) {
    return null;
  }

  const tmdbId = Number(match[1]);

  const vf = await getVFRecord(tmdbId);

  if (!vf) {
    return null;
  }

  const movie = await getMovie(tmdbId);

  if (
    !movie ||
    String(movie.original_language || "").toLowerCase() === "fr"
  ) {
    return null;
  }

  // IMDb ID nécessaire pour BetterPoster
  const imdbId = movie.imdb_id || null;

  const poster = imdbId
    ? `${BETTERPOSTER_BASE}/${encodeURIComponent(imdbId)}.jpg?lang=fr`
    : movie.poster_path
      ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
      : undefined;

  return {
    id,
    type: "movie",
    name: movie.title || movie.original_title,
    poster,
    background: movie.backdrop_path
      ? `${BACKDROP_BASE}${movie.backdrop_path}`
      : undefined,
    description: movie.overview || "",
    releaseInfo: movie.release_date || "",
    imdbRating: movie.vote_average || undefined,
    genres: (movie.genres || []).map((g) => g.name),
    posterShape: "poster",

    meta: {
      tmdb_id: movie.id,
      imdb_id: imdbId,
      original_title: movie.original_title,
      vf: true,
      vf_country: vf.vf_country || null,
      vf_source: vf.source || null,
      vf_verified: true
    }
  };
}
