# Place a map's authored setanimal records as visible animals

**Area:** app · **Origin:** map-visual-fidelity plan reconciliation, 2026-07-12 · **Blocked by:**
[animal-render-binding](../render/animal-render-binding.md) · **Priority:** P2

Imported maps show no animals at all: `resolveAuthoredPlacements` skips `entities.animals`
(`packages/app/src/slice/authored-placements.ts` — `vertical-slice.ts` logs "deferred N animals"),
and `seedAnimalHerds` is not called anywhere in `packages/app`. The sim side is done (herd system —
see the render ticket). The bridge map authors 433 animals.

## Scope

- Resolve authored species names against the IR animals table; place them via
  `spawnAnimalHerd`/`seedAnimalHerds` (or a standing-only path) — deterministic, count + skip
  unresolvables with a log.

## Verify

- App unit test for the species join.
- `?map=specjalna_mosty_na_rzece`: deer/hares at the authored spots — **user's eyes**.
