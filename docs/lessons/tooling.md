# Lessons — tooling & process (build/test glue, cross-package, docs)

Part of the loop's hard-won memory. The contract (one entry per trap, commit-grounded,
extend-don't-duplicate, graduate a thrice-hit trap to an `AGENTS.md`) lives in
[`../LESSONS.md`](../LESSONS.md) — read it before adding here.

- [ca10cf4] raw-TS strip-types can't resolve the sim's `.js` import specifiers, so the test fixture
  isn't in `dist/` — hands-on sim smoke runs go through a throwaway `vitest` spec on the real
  `Simulation.step()` schedule, not compiled `dist/`. (tooling)
- [79e02a7] Importing a `test/` file (e.g. a fixture) from production `src/` drags it into that
  package's `tsc --build` graph, which emits `.js`/`.d.ts` *in-place next to the .ts* — stray
  untracked artifacts `biome check` then lints and fails on. Keep dev/demo fixtures self-contained in
  `src/` (a tiny synthetic copy), don't reach across into another package's `test/`. (tooling/render)
- [690a547] **Rebuild `dist/` before trusting a cross-package test.** vitest resolves a cross-package
  import (`@vinland/data`) through that package's BUILT `dist/`, not its `src/`, so a brand-new export
  is `… is not a function` in another package's test until you `npm run build` — green source,
  runtime-missing symbol. The twin trap [7dbb3c9]: a new zod **schema field** is silently STRIPPED — a
  stale `dist/schema.js` `.parse()`-drops any key it doesn't know, so the extractor visibly sets it but
  the test's `toEqual` shows it MISSING (a false-red that reads like a casing/getInt bug);
  `grep -c <field> packages/data/dist/schema.js` tells you if dist is current (0 = stale). Rebuild
  after adding an export OR a schema field consumed by another package's test. (tooling)
- [9433030] A `{@link Foo}` in a new file's JSDoc only resolves if `Foo` is defined or imported IN that
  file — a cross-module link to a sibling read-view symbol (`{@link shipVehicles}` from `jobs.ts`) is
  DANGLING even though `check`/`build` stay green (biome/tsc don't validate tsdoc link targets, so it
  passes silently and only a reviewer catches it — the exact de39b3d finding, recurring). When you
  copy a doc block from a sibling module as a template, downgrade any `{@link X}` whose `X` you didn't
  also import to plain `` `X` `` backticks. (docs)
