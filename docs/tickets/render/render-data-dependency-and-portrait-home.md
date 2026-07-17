# Two small render ownership calls: the unused `@open-northland/data` dep, and portrait-inset's home

**Area:** render · **Origin:** /refactor-cleanup on packages/render, 2026-07-17 · **Priority:** P3

Two independent judgement calls left out of the 2026-07-17 cleanup because each needs a decision rather
than a move. Do either or both.

## 1. `@open-northland/data` is declared but never imported — so one of two comments is wrong

`packages/render/package.json` declares `"@open-northland/data": "*"`, and `packages/render/src` imports
it **nowhere** (verified 2026-07-17 — the only hits are prose and one `{@link import('@open-northland/data')
.GfxAnimAtomic}` doc reference, neither of which is a real import).

Meanwhile `data/terrain/transitions.ts` duplicates that package's `TRANSITION_NONE` / `TRANSITION_PAIRS`
and justifies the copy by keeping the module "import-decoupled from `@open-northland/data`". Today those
two statements contradict each other: the package is a declared dependency, so nothing is decoupled at
the manifest level, yet the constants are copied as if it were.

Decide:
- **(a)** Drop the dependency from `package.json`. The decoupling argument becomes true, and the
  duplication becomes a deliberate, correctly-documented choice. (`data/terrain/uv.ts` makes the same
  claim — "the renderer stays decoupled from `@open-northland/data`" — so this is the direction the code
  already believes it is going.)
- **(b)** Keep the dependency and import the constants, deleting the duplicate and its justification.

Either way the encoding stops living in two places with a comment asking a future editor to remember both.

## 2. `overlays/portrait-inset.ts` is not an overlay

`gpu/overlays/index.ts` declares the folder is layers that are "each a pure projection of the frozen
snapshot + plain per-frame data into one slice of the scene graph".

`portrait-inset.ts` is none of that: it takes the `Application` and the `worldLayer` in its constructor,
mounts its own `app.stage` child, drives a **second whole-world render**, mutates the shared world
transform, and reaches into `SpritePool` six ways. It is a renderer-level orchestrator filed with the
washes and rings. (`hud-layer.ts` is a milder version — pinned chrome, not under the camera — and is
covered by [hud-layer-shot-ownership](hud-layer-shot-ownership.md).)

Move it to `gpu/portrait/` with an `index.ts` barrel, imported directly by `world-renderer/`; external
paths stay stable via `src/index.ts`. Correct `overlays/index.ts`'s doc to stop claiming the pinned /
second-render surfaces are pure projections.

**Do not** sub-split `overlays/` generally (`ground/`, `markers/`, `chrome/`): all 13 files are ≤ 222
lines, the barrel's prose already communicates the grouping, and the churn would buy nothing.

## Verify

`npm test`, `npm run check`, `npm run build`. For (1b), confirm the emitted terrain lanes are unchanged
(the constants must be equal — if they are not, that is the bug the duplication was hiding, and it is a
finding, not a merge conflict). For (2), a `?shot` byte-comparison plus a human pass on the details-panel
portrait — it is a second render of the world and pixels need eyes.
