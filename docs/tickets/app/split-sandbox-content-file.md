# Split game/sandbox/content.ts into a content/ subfolder

**Area:** packages/app · **Origin:** /refactor-cleanup app (Tier A follow-up), 2026-07-12

The `sandboxContent()` god function was decomposed into per-domain builders
(`buildSandboxBuildings`/`buildSandboxJobs`/`buildSandboxTribes`, `sandboxLandscapeGfx`/
`sandboxGatheringPipeline`) in the 2026-07-12 refactor pass, so the assembly now reads clearly. But
`packages/app/src/game/sandbox/content.ts` is still ~858 lines (over the ~500-line file budget): the
declarative `parseContentSet({...})` data literal (goods/weapons/atomicAnimations arrays) plus the
combat/store/farmer animation constants, `BUILDING_OVERRIDES`, and `buildingRow` all still live in
the one file.

## Scope

Behavior-preserving split into a `game/sandbox/content/` subfolder (index barrel keeps the
`sandboxContent`/`sandboxGoods`/`sandboxWalkableTypeIds` import surface stable via `game/sandbox/`'s
own `index.ts` re-export). Candidate seams by concern:

- `content/landscape.ts` — `BASE_LANDSCAPE`, resource-type bases, the block/work-area helpers,
  `sandboxLandscape`/`sandboxWalkableTypeIds`.
- `content/buildings.ts` — `SandboxBuildingRow`, store-capacity constants, `STORE_GOODS`/`storeStock`,
  `BUILDING_OVERRIDES`, `buildingRow`, `buildSandboxBuildings`.
- a shared `content/animations.ts` for the combat/store/farmer animation NAMES + LENGTHS that
  `buildSandboxTribes` and the atomicAnimations list both consume (today they repeat the
  `viking_*_attack` string literals — dedupe them into named constants as the split's own hunk).

Watch the shared-constant coupling (weapon damage ↔ weapons; animation name/length ↔ tribes +
atomicAnimations) — that coupling is why the file wasn't split in the original pass. Keep the golden
content byte-identical (no behavior change): the app content tests + scene goldens must not move.

## Verify

`npm test` (map-resources, map-gatherer-cycle, scenes stay green), `npm run check`, `npm run build`,
`npm run scan:structure` (content.ts under budget).
