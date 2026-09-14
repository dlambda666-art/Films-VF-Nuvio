import express from "express";

const app = express();
const PORT = process.env.PORT || 8080;

const manifest = {
  id: "films-vf-nuvio",
  version: "1.0.0",
  name: "Films VF Nuvio",
  description: "Catalogue dynamique dédié aux films étrangers doublés en français.",
  resources: ["catalog", "meta"],
  types: ["movie"],
  catalogs: [
    { type: "movie", id: "nouveautes-vf-2026", name: "Nouveautés VF 2026" },
    { type: "movie", id: "vf-2025", name: "VF 2025" },
    { type: "movie", id: "action", name: "Action" },
    { type: "movie", id: "thriller", name: "Thriller" },
    { type: "movie", id: "horreur", name: "Horreur" },
    { type: "movie", id: "science-fiction", name: "Science-fiction" },
    { type: "movie", id: "fantastique", name: "Fantastique" },
    { type: "movie", id: "aventure", name: "Aventure" },
    { type: "movie", id: "crime-policier", name: "Crime/Policier" },
    { type: "movie", id: "guerre", name: "Guerre" },
    { type: "movie", id: "western", name: "Western" },
    { type: "movie", id: "mystere", name: "Mystère" },
    { type: "movie", id: "historique", name: "Historique" }
  ]
};

app.get("/manifest.json", (_req, res) => res.json(manifest));

app.get("/catalog/:type/:id.json", (_req, res) => {
  res.json({ metas: [] });
});

app.get("/meta/:type/:id.json", (_req, res) => {
  res.status(404).json({ error: "Meta not found" });
});

app.get("/", (_req, res) => {
  res.type("text").send("Films VF Nuvio - addon running");
});

app.listen(PORT, () => {
  console.log(`Films VF Nuvio running on port ${PORT}`);
});
