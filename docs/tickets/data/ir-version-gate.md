# Enforce (or stop documenting) the `ir.json` schema-version gate

**Area:** data (+ app, desktop) · **Origin:** data+pipeline refactor-cleanup pass, 2026-07-17 · **Priority:** P3

`docs/DATA-FORMAT.md` states that `ir.json.version` bumps on schema changes and that **the sim
refuses to load a mismatched major version** — "a version mismatch is a hard load error". No such
check exists.

Verified 2026-07-17 by grepping `manifest.version|IR_VERSION|irVersion` across `packages/*/src` and
`tools/*/src`:

- `packages/data/src/schema/content/content-set.ts` accepts any positive int
  (`version: z.number().int().positive()`).
- `parseContentSet` (`packages/data/src/index.ts`) runs `ContentSet.parse` + `validateCrossReferences`
  and never compares versions.
- The only writers are `tools/asset-pipeline/src/stages/ir/index.ts` and
  `packages/app/src/game/sandbox/content/index.ts`.
- `packages/desktop/src/content-state.ts` does compare a version — but that is
  `pipeline-manifest.json`'s `irVersion` (a staleness check on a *different* artifact), not
  `ir.json`'s `manifest.version`.

So the field is write-only and the doc asserts an enforcement that does not exist. A stale `content/`
against a newer schema fails as a confusing zod error deep in a field, or not at all.

## Scope

Pick one:

- **Enforce**: compare `manifest.version` against `IR_VERSION` in `parseContentSet` and throw a
  readable mismatch error. Note this is a **behavior change** — it starts rejecting sets today's code
  accepts, including any hand-built fixture or authored slice content carrying a stale version. Audit
  every `parseContentSet` caller and fixture first (`packages/app/src/game/sandbox/content/`, the
  `packages/*/test/` builders) and decide major-only vs exact match.
- **Correct the doc**: rewrite `docs/DATA-FORMAT.md` to describe the real mechanism (the desktop's
  `pipeline-manifest.json` staleness compare) and drop the claim that the loader gates on it.

## Verify

- `npm test`, `npm run check`, `npm run build`.
- If enforcing: `npm run test:content` with a local `content/`, and a case pinning that a mismatched
  version throws a readable error.

## Source basis

Internal loader-contract consistency; no original-behavior claim.
