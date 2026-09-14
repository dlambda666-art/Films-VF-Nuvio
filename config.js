export const CONFIG = {
  maxResults: 40,
  tmdbPages: 8,

  excludedMovieGenres: new Set([99, 10402, 10770]),

  catalogs: [
    { id: "nouveautes-vf-2026", name: "Nouveautés VF 2026" },
    { id: "vf-2025", name: "VF 2025" },
    { id: "action", name: "Action" },
    { id: "thriller", name: "Thriller" },
    { id: "horreur", name: "Horreur" },
    { id: "science-fiction", name: "Science-fiction" },
    { id: "fantastique", name: "Fantastique" },
    { id: "aventure", name: "Aventure" },
    { id: "crime-policier", name: "Crime/Policier" },
    { id: "guerre", name: "Guerre" },
    { id: "western", name: "Western" },
    { id: "mystere", name: "Mystère" },
    { id: "historique", name: "Historique" }
  ],

  genreMap: {
    action: 28,
    thriller: 53,
    horreur: 27,
    "science-fiction": 878,
    fantastique: 14,
    aventure: 12,
    "crime-policier": 80,
    guerre: 10752,
    western: 37,
    mystere: 9648,
    historique: 36
  }
};
