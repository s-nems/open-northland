# Fold the sim builders' optional tail into an options object

**Area:** app (slice + scenes) · **Origin:** real-content-switch introduced the 7th/8th positional param · **Priority:** P3

`slice/vertical-slice.ts`'s `runSlice`, `runBareMap`, and `runAuthoredSlice` grew a long tail of optional
positional params — `owner?`, `footprints?`, `goodNames?`, `contentOverride?` — so call sites read as
opaque argument runs, e.g.:

```ts
runSlice(SLICE_SEED, 1, undefined, HUMAN_PLAYER, footprints, goodNames, realContent?.content)
runAuthoredSlice(SLICE_SEED, 1, simMap, loaded.entities, ir, footprints, goodNames, realContent?.content)
```

The `undefined` placeholder and the trailing map/map/ContentSet triple are exactly the readability smell
`AGENTS.md` ("Readability first") warns about — a reader can't tell what each slot is without counting.

`scenes/runtime.ts`'s `createSceneSim(scene, extras?, content?)` has the same tail, plus a latent trap: a
passed `content` silently supersedes `extras` (its `buildingFootprints`/`goodNames` are dropped, since they
only feed the default sandbox-content path). Documented in its doc comment, but the shape invites misuse.

## Scope

Collapse the optional tail into a single `opts?: { owner?; footprints?; goodNames?; content? }` object on
the three slice builders and fold `createSceneSim`'s `extras?`/`content?` tail into the same object shape
(keep the required leading params — `seed`, `ticks`/`map`, `scene`, etc. — positional). Update the call
sites: `entries/map.ts`, the `?shot` call in `entries/shot.ts`, `entries/scene.ts`, and the
`test/vertical-slice.test.ts` cases. Behavior is unchanged — a pure signature refactor; the sim goldens and
the deterministic shot PNG must stay byte-identical.

## Verify

`npm test` + `npm run build` + `npm run check` green; sim-package goldens and the `?shot` PNG unchanged
(this is a call-shape refactor only, no behavior change).
