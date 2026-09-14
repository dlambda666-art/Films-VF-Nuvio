export const CONFIG = {
  maxResults: 40,
  tmdbPages: 8,

  excludedMovieGenres: new Set([
    18,    // Drame
    35,    // Comédie
    10749, // Romance
    10751, // Famille
    16,    // Animation
    99,    // Documentaire
    10402, // Musique
    10770  // Téléfilm
  ]),

  catalogs: [
    {
      id: "nouveautes-vf",
      name: "Nouveautés VF"
    },
    {
      id: "horreur",
      name: "Horreur VF"
    }
  ],

  genreMap: {
    horreur: 27
  }
};
