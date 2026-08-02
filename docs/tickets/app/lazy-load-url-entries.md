# Lazy-load browser entry modes

**Area:** app · **Focus:** entries · **Priority:** P2

`packages/app/src/main.ts` statically imports the playable mode and every development gallery before it
examines the URL. The current production build emits a 1,121.03 kB main JavaScript chunk (347.06 kB gzip),
above the configured 1,024 kB warning limit and the stale 810 kB estimate in `vite.config.ts`. A normal menu
or game boot therefore downloads and parses code for screenshot, animation, icon, sound, scene, and map
tools it does not use.

## Scope

- Keep `main.ts` as the URL dispatcher but dynamically import only the selected entry module. Preserve
  crash capture, locale setup, boot progress, and each existing query-string route.
- Give the default menu/play path an explicit measured compressed-size budget and fail or warn through the
  existing build tooling when it regresses beyond the agreed tolerance. Report route chunk sizes rather
  than raising the global warning limit.
- Keep shared runtime/render code in shared chunks chosen by Vite. Do not duplicate Pixi or manually split
  modules without bundle output proving a benefit.

## Verify

- Route tests cover every URL mode after asynchronous loading and retain the screenshot readiness contract.
- `npm run build` produces no chunk over the configured warning limit and records the before/after main and
  route chunk sizes.
- Manually boot the default menu, one playable map, and one development gallery with network cache disabled;
  each loads only its required entry chunk and shows no boot-progress regression.
- `npm test` and `npm run check`.
