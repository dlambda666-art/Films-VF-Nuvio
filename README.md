# VF Index Sync

Ce dossier alimente `vf-index.json` avec les films dont une VF confirmée est recensée par DoublageVF.

- Premier lancement : utiliser `workflow_dispatch` avec `full_sync = true`.
- Ensuite : le workflow planifié rescane les 12 premières pages chaque jour.
- Les entrées déjà présentes sont conservées.
- Seules les fiches identifiées avec un TMDB ID et une section de doublage français confirmée sont ajoutées.
