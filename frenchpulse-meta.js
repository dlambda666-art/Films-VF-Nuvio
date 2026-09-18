/* Shared FrenchPulse metadata contract. Additive and safe for Stremio clients. */

export const FRENCHPULSE_META_VERSION = 1;

export function buildFrenchPulseMeta({
  tmdbId = null,
  imdbId = null,
  originalTitle = null,
  vf = false,
  vfSource = null,
  vfVerified = false,
  quality = null,
  status = null,
  reason = null,
  digitalReleaseDate = null
} = {}) {
  return {
    frenchpulse_meta_version: FRENCHPULSE_META_VERSION,
    tmdb_id: tmdbId,
    imdb_id: imdbId,
    original_title: originalTitle,
    vf: Boolean(vf),
    vf_source: vfSource,
    vf_verified: Boolean(vfVerified),
    quality,
    status,
    reason,
    digital_release_date: digitalReleaseDate
  };
}
