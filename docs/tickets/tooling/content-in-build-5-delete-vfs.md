# Delete the vfs seam and read the file system directly in the pipeline

**Area:** vfs, pipeline · **Focus:** content delivery · **Priority:** P3
**Blocked by:** [Write the served content layout](content-in-build-2-served-layout.md)

`packages/vfs` exists so one conversion codebase could run over Node and over browser storage.
After the preceding tickets the pipeline runs only in Node (a developer's shell and the release
job), the OPFS adapter and the content resolver are gone, and the desktop reads through `node:fs`.
The seam is then an indirection with one implementation: 28 pipeline source files import `vjoin`,
`readText`, `writeText` or the `Vfs` types for no benefit, and every new stage has to be written
against it.

## Scope

- Pipeline stages and `run.ts` take a root path and use `node:fs/promises` and `node:path`
  directly. `resolveModRoot` and `walk.ts` do the same.
- The two tests that build trees with the memory adapter (`test/roots.test.ts`,
  `test/music-stage.test.ts`) write their fixtures into a temporary directory instead.
- The in-process embedding surface has no host left: delete `src/progress.ts` with the `progress`
  parameters the stages thread through, the `./progress` and `./mod-root` subpath exports in
  `package.json`, and narrow `src/index.ts` to what the CLI and the tests import. The CLI stays the
  only entry.
- Delete `packages/vfs` (workspace, root `tsconfig.json` reference, `AGENTS.md` contract entry,
  `check-docs.mjs` area, `docs/tickets/README.md` area list) and every remaining
  `@open-northland/vfs` dependency.
- Non-goal: changing what the pipeline writes or how stages are ordered.

## Verify

`npm run check`, `npm run check:docs`, `npm run typecheck`, `npm run build`, Vitest for
`tools/asset-pipeline`. `npm run test:pipeline` against `../CNMod-1.3.2` passes and its output file
list is unchanged from before the ticket. `grep -rn "@open-northland/vfs" packages tools` finds
nothing.
