# Make the catalog the single job-id import surface

**Area:** app · **Priority:** P3

Job ids are declared in `catalog/jobs.ts`, but `game/sandbox/ids/economy/jobs.ts` re-exports the same
table. Production and tests import both paths, and `content/settler-gfx/character-specs.ts` still keys
several character bindings with bare numeric ids. The declaration is single; the read surface is not.

## Scope

- Import shared job ids from `catalog/jobs.ts` throughout the app.
- Keep the sandbox ids module for sandbox-derived ids only and remove its catalog re-export.
- Replace character binding literals with the catalog constants. Do not change any numeric id or
  worker-slot table.
- `catalog/professions.ts` `isSoldierJob` still reads the raw 31..41 band for the shared "Żołnierz"
  label, and `professionDefForJob` applies it to real-content job ids. The sim classifies that role from
  content now (`systems.isSoldierJob`); decide whether the label should follow or the band stays catalog
  policy.

## Verify

`npm test`, `npm run check`, and `npm run build`; the resolved worker-slot and character-binding tables
are unchanged.
