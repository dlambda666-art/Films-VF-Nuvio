const TMDB_BASE = "https://api.themoviedb.org/3";

function getApiKey() {
  const key = process.env.TMDB_API_KEY;
  if (!key) throw new Error("TMDB_API_KEY is missing");
  return key;
}

async function tmdb(path, params = {}) {
  const url = new URL(`${TMDB_BASE}${path}`);
  url.searchParams.set("api_key", getApiKey());
  url.searchParams.set("language", "fr-FR");

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`TMDB ${response.status}`);
  }

  return response.json();
}

export async function discoverMovies(params = {}) {
  return tmdb("/discover/movie", {
    include_adult: false,
    sort_by: "popularity.desc",
    ...params
  });
}

export async function getMovie(movieId) {
  return tmdb(`/movie/${movieId}`, {
    append_to_response: "release_dates,credits"
  });
}
