# Decide the fate of the production-dead hud/bitmap-text.ts

**Area:** app (hud/bitmap-text.ts + content/font-gfx.ts + packages/app/AGENTS.md) ·
**Origin:** /refactor-cleanup on packages/app, 2026-07-17 · **Priority:** P3
**Needs user:** two project contracts collide and an agent must not silently pick a side — this is a
"do we still want the exact original face?" decision.

`packages/app/src/hud/bitmap-text.ts` is dead in production. Nothing under `packages/**` or `tools/**`
imports `makeTextRun`, `createBitmapTextRun`, `loadBitmapFont`, `BitmapFont`, or `DEFAULT_FONT_KEY`.
Its only importer anywhere is `packages/app/test/bitmap-text.test.ts`, which imports just
`CP1250_HIGH_ENTRIES` / `cp1250Byte` — so even the test never exercises the font/glyph-run half. Every
other reference is prose in comments (`content/ui-font.ts:5`, `hud/text-run.ts:5`, `hud/ui-text.ts:12`,
`hud/details-panel/chrome.ts:22`). The HUD draws through `hud/ui-text.ts`'s vector kit instead.

The contracts collide:

- root `AGENTS.md`: "**Delete dead code.** Unused exports, commented-out blocks, and leftover shims go;
  git history is the archive."
- `packages/app/AGENTS.md:99`: "the decoded `.fnt` bitmap path (`bitmap-text.ts`) stays available for
  anything that must be the exact original face" — an explicit retention, restated at `:74`.

Deleting it also strands part of `content/font-gfx.ts`: `loadFontIndexed`, `loadFontColorLut` and
`loadFontMetrics` have no other consumer, though `FontColorName` and `FONT_FILL` stay live
(`hud/ui-text.ts`, `hud/tool-panel/context.ts`, `hud/details-panel/{chrome,text}.ts`,
`content/ui-font.ts`). The pipeline's font stage (`tools/asset-pipeline/src/stages/fonts.ts`) also
names `content/font-gfx.ts` as its runtime mirror — check whether the stage's outputs become
unconsumed too before deleting anything.

**Source basis:** the retention clause is a fidelity claim (the original's exact `.fnt` face); whether
it still matters is the user's call.

## Scope

One of, decided with the user — not both, and not neither:

- **Delete:** remove `bitmap-text.ts` (keeping `CP1250_HIGH_ENTRIES`/`cp1250Byte` wherever the CP1250
  mapping still earns its test), drop `content/font-gfx.ts`'s now-unused `.fnt` loaders, prune the
  prose references above, **and delete the `packages/app/AGENTS.md` retention clause** — a contract
  that names a deleted module is worse than the dead code. Decide the pipeline font stage's fate in the
  same pass.
- **Keep:** leave the module, and sharpen the AGENTS.md clause to say what would actually use it and
  when, so the next dead-code sweep doesn't re-litigate this.

## Verify

`npm test`, `npm run check`, `npm run build`. On the delete path: `npm run test:pipeline` if the font
stage changes, and a browser pass on `?scene=sandbox` confirming the HUD text is untouched (it draws
through the vector kit either way).
