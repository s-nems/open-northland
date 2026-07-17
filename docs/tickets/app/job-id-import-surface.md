# Settle the job-id import surface: catalog/jobs.ts or the sandbox ids barrel

**Area:** app (catalog/jobs.ts + game/sandbox/ids/) · **Origin:** /refactor-cleanup on packages/app,
2026-07-17 · **Priority:** P3

The `jobtypes.ini` id space used to be re-declared in five places (two of them bare literals like
`9: 'joiner'`), so the mirrors could drift silently. It now has one home in
`packages/app/src/catalog/jobs.ts`, which also broke the `catalog/` ↔ `game/sandbox/ids/` mutual
dependency — `catalog/professions.ts` no longer imports out of `game/`.

The leftover is the import surface. `game/sandbox/ids/economy/jobs.ts:15` does
`export * from '../../../../catalog/jobs.js'`, so the same constant is reachable by two paths, and the
tree uses both: **24** import sites take job ids through the sandbox barrel (scenes, view, hud, slice,
tests) and **5** take them from `catalog/jobs.js` directly (`catalog/professions.ts`,
`game/sandbox/worker-slots.ts`, `game/character-names/index.ts`, `content/settler-gfx/character-specs.ts`,
`test/character-names.test.ts`). A reader can't tell which is intended, and the sandbox barrel also
carries its own derived ids (`WORKER_SLOT_JOB_BASE`, `rebaseSlotJob`, `EXTRACTED_GATHERER_TRADES`), so
the re-export is not obviously wrong either.

The re-export was kept because repointing 24 call sites was out of scope for the pass that moved the
declarations.

One mirror the pass did not reach: `content/settler-gfx/character-specs.ts`'s `ADULT_CHARACTER_BY_JOB`
still keys on bare literals (`31: 'warrior'`, `32: 'warrior-spear'`, …). The values match
`jobtypes.ini`, but it is the same drift risk the consolidation removed elsewhere — fold it in.

**Source basis:** structural/ownership, not a mechanic — the id values themselves are pinned to
`jobtypes.ini` and must not change.

## Scope

Pick one and make the tree say it:

- **One home wins:** repoint the 24 sandbox-barrel consumers at `catalog/jobs.js` and delete the
  `export *`, leaving `game/sandbox/ids/economy/jobs.ts` holding only the sandbox's own derived ids.
- **The composed barrel wins:** keep the re-export, repoint the 5 direct importers at the barrel, and
  say in `packages/app/AGENTS.md` that `game/sandbox/ids/` is the intended read surface and
  `catalog/jobs.ts` the declaration home.

Either way the values are untouched — this is import paths only.

## Verify

`npm test`, `npm run check`, `npm run build`. Nothing behavioural moves; a useful extra proof is to
diff the resolved `BUILDING_WORKER_SLOTS` table (88 rows of `(jobType, count)`) before and after and
confirm it is identical.
