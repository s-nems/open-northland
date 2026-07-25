# Place a map's authored setanimal records as visible animals

**Area:** app · **Priority:** P2

Imported maps show no animals at all: `resolveAuthoredPlacements` skips `entities.animals`
(`packages/app/src/slice/authored-placements.ts` — `vertical-slice.ts` logs "deferred N animals"),
and `seedAnimalHerds` is not called anywhere in `packages/app`. The sim side is done (herd system)
and the render binding now draws species bodies (`content/animal-gfx/`), so placed animals are
visible. The bridge map authors 433 animals; butterflies among them stay a named invisible gap
(`cr_ani_body_01` ships no readable sequences).

## Scope

- Resolve authored species names against the IR animals table (species string → tribes `id`/`name`
  join, `normalizeRoleKey` for dirty variants like `'cattle '` / `'evil hares'`); a record must also
  have an `animals` row or the sim drops the spawn silently.
- One `setanimal` record = one animal at its authored half-cell: extend `spawnAnimalHerd` with an
  optional `count` override (a verbatim per-record herd would multiply by `maximumgroupsize` and
  trample authored positions). Deterministic; count + skip unresolvables with a log.

## Verify

- App unit test for the species join; sim test for the `count` override.
- `?map=specjalna_mosty_na_rzece`: deer/hares at the authored spots — **user's eyes**.
