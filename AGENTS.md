# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- This is BenVae/dossier, a fork of AienTech/dossier that merges upstream regularly: keep fork-only changes small and their values in one place, so merges conflict little.
- The fork's update check compares the commit an install was built from (`DOSSIER_COMMIT`, which `scripts/install-windows.ps1` passes to the Dockerfile) with the fork's main, not upstream's releases. Its fork-specific values live in `src/lib/releases.ts`; keep that design when a merge from upstream touches `src/lib/update-check.ts` or the update notice.
- Database tests (`*.db.test.ts`) need Postgres. Without Docker, `@electric-sql/pglite-socket`'s `pglite-server --extensions=citext` works, with `TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:<port>/dossier_test?sslmode=disable`.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
