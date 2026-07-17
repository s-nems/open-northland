# Pin the details panel's per-frame gating with a test

**Area:** app (hud/details-panel/panel.ts) · **Origin:** /refactor-cleanup on packages/app,
2026-07-17 · **Priority:** P3

`mountUnitPanel` (`packages/app/src/hud/details-panel/panel.ts`) now bounds two per-frame costs, and
neither is pinned by a test:

- `modelFor` memoizes the panel model **and** its `JSON.stringify` per `snapshot.tick`, busted by
  `force` (a new selection). Before this, every RAF frame re-ran several O(entities) passes
  (`buildUnitPanelModel`'s classify, `boundCountsByJob`, `fieldCounts`, `familiesByHome`) plus a
  whole-model stringify — roughly three times per 20 Hz sim tick.
- `refreshWorkers` skips when `snapshot.tick | app.screen.width x height | panelEpoch` is unchanged
  (`panelEpoch` bumps in `rebuild`, the only place its model/layout inputs change).

Both keys carry the screen size because it is **load-bearing**: a resize at an unchanged tick must
still re-anchor the panel. Nothing proves that today, so the gate can silently regress into either a
per-frame O(entities) scan (the cost this removed) or a panel that ignores a resize.

The gate is untested because it can't be reached: `mountUnitPanel` needs a real Pixi `Renderer`
(`bakeToSprite`), `FontFace` and `fetch`, and no test in the repo mounts a Pixi `Application`. Mocking
all of `@open-northland/render` to get at it would cost more than it proves — the seam is the problem,
not the test.

**Source basis:** structural/perf (root `AGENTS.md` golden rule 6: per-frame cost scales with the
screen, never the whole map). No mechanic or visual change intended.

## Scope

- Find the seam that makes the gating decision testable without mounting Pixi — e.g. lift the pure
  "should we rebuild?" decision (tick, screen size, epoch, force → rebuild/skip) out of the mount
  closure into a sibling pure module, the way `hud/tool-panel/`'s pure models are already split from
  their window controllers.
- Pin: same tick → no model rebuild; new tick → rebuild; resize at the same tick → rebuild; new
  selection (`force`) → rebuild regardless of tick.
- Keep behaviour identical — this is a testability refactor, not a re-design of the gate.

## Verify

`npm test`, `npm run check`, `npm run build`. Manual, since the panel's pixels need a human:
`npm run dev` → `?scene=sandbox`, select a home/farm/store — live values still refresh at the 4 Hz
rebuild cadence, the worker row still animates, and resizing the window still re-anchors the panel.
