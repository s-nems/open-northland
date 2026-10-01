# Draw the species goods' icons on the DOM HUD

**Area:** app · **Priority:** P3

The DOM good-icon painter (`hud/dom/good-art.ts`) resolves a good through the presentation pack or the
`ls_goods` manifest, which has no sheep or cattle: the original draws no pile for them. A breeding farm's
Production lines in the building panel and a breeder's production rows in the settler panel therefore show
empty wells. The legacy Pixi panel drew the animal itself, one standing frame cut from the body atlas the
sheet holds for the map; that path went with the Pixi building panel.

## Scope

- Give the painter a source for species goods: the animal's standing frame from the loaded sheet,
  baked once per good into a shared page (never one canvas per icon, see `packages/app/AGENTS.md`).
- Name the approximation: the original shows no icon on these rows.

## Verify

A unit test of the resolver for a species good. Browser: `?scene=livestock`, select the animal farm and
a breeder; both panels show the sheep and the ox.
