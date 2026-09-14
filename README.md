---
title: Films VF Nuvio
emoji: 🎬
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
---
# Films VF Nuvio

Catalogue Nuvio dynamique dédié aux films étrangers doublés en français (VF).

## Architecture

TMDB fournit les candidats et les métadonnées.  
Un index VF indépendant contient uniquement les films dont la VF est confirmée.

Le catalogue Nuvio lit cet index et ne dépend pas de Frankenstream.

## VF Index Sync

Le script `scripts/sync-vf-index.js` alimente `vf-index.json` à partir des fiches publiques de DoublageVF.

Le workflow GitHub Actions `.github/workflows/vf-index-sync.yml` permet de lancer la synchronisation automatiquement.

## Configuration

Le projet utilise notamment :

- `TMDB_API_KEY` pour les appels TMDB.
- `VF_INDEX_URL` pour l'URL publique de `vf-index.json`.

## Catalogue

Films uniquement :

- Nouveautés VF 2026
- VF 2025
- Action
- Thriller
- Horreur
- Science-fiction
- Fantastique
- Aventure
- Crime/Policier
- Guerre
- Western
- Mystère
- Historique

Projet indépendant de Frankenstream.
