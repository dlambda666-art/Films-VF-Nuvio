const VF_INDEX_URL = process.env.VF_INDEX_URL || "";

let cache = null;
let cacheTime = 0;
const CACHE_TTL = 15 * 60 * 1000;

function normalize(item) {
  if (!item || item.tmdb_id == null) return null;

  const tmdb_id = Number(item.tmdb_id);
  if (!Number.isInteger(tmdb_id) || tmdb_id <= 0) return null;

  const status = String(item.status || "confirmed").toLowerCase();
  const confirmed =
    item.vf_confirmed !== false &&
    !["pending", "unverified", "rejected"].includes(status);

  return {
    tmdb_id,
    vf_confirmed: confirmed,
    vf_country: item.vf_country || null,
    source: item.source || "unknown",
    confidence: Number(item.confidence ?? 1),
    status,
    last_verified: item.last_verified || null
  };
}

async function loadIndex() {
  if (!VF_INDEX_URL) return [];

  if (cache && Date.now() - cacheTime < CACHE_TTL) return cache;

  const response = await fetch(VF_INDEX_URL);
  if (!response.ok) throw new Error(`VF index ${response.status}`);

  const payload = await response.json();
  const items = Array.isArray(payload) ? payload : payload.items;

  if (!Array.isArray(items)) throw new Error("Invalid VF index format");

  cache = items.map(normalize).filter(Boolean).filter(x => x.vf_confirmed);
  cacheTime = Date.now();

  return cache;
}

export async function getVerifiedVFIds() {
  return new Set((await loadIndex()).map(x => x.tmdb_id));
}

export async function getVFRecord(tmdbId) {
  return (await loadIndex()).find(x => x.tmdb_id === Number(tmdbId)) || null;
}

export function clearVFCache() {
  cache = null;
  cacheTime = 0;
}
