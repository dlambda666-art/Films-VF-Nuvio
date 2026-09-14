import express from "express";
import { buildCatalog } from "./catalog.js";
import { buildMeta } from "./meta.js";

const app = express();
const PORT = Number(process.env.PORT || 8080);

const catalogs = [
  ["nouveautes-vf-2026", "Nouveautés VF 2026"],
  ["vf-2025", "VF 2025"],
  ["action", "Action"],
  ["thriller", "Thriller"],
  ["horreur", "Horreur"],
  ["science-fiction", "Science-fiction"],
  ["fantastique", "Fantastique"],
  ["aventure", "Aventure"],
  ["crime-policier", "Crime/Policier"],
  ["guerre", "Guerre"],
  ["western", "Western"],
  ["mystere", "Mystère"],
  ["historique", "Historique"]
];

const manifest = {
  id: "films-vf-nuvio",
  version: "1.0.0",
  name: "Films VF Nuvio",
  description: "Catalogue dynamique dédié aux films étrangers doublés en français.",
  resources: ["catalog", "meta"],
  types: ["movie"],
  catalogs: catalogs.map(([id, name]) => ({
    type: "movie",
    id,
    name
  }))
};

app.get("/manifest.json", (_req, res) => {
  res.json(manifest);
});

app.get("/catalog/:type/:id.json", async (req, res) => {
  if (req.params.type !== "movie") {
    return res.json({ metas: [] });
  }

  try {
    res.json({ metas: await buildCatalog(req.params.id) });
  } catch (error) {
    console.error("Catalog error:", error);
    res.status(500).json({ metas: [], error: "Catalog unavailable" });
  }
});

app.get("/meta/:type/:id.json", async (req, res) => {
  if (req.params.type !== "movie") {
    return res.status(404).json({ error: "Meta not found" });
  }

  try {
    const meta = await buildMeta(req.params.id);
    if (!meta) return res.status(404).json({ error: "Meta not found" });
    res.json({ meta });
  } catch (error) {
    console.error("Meta error:", error);
    res.status(500).json({ error: "Meta unavailable" });
  }
});

app.get("/", (_req, res) => {
  res.type("text").send("Films VF Nuvio - addon running");
});

app.listen(PORT, () => {
  console.log(`Films VF Nuvio running on port ${PORT}`);
});
