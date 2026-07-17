# Name the world on the boot card

**Area:** app (view, entries) · **Origin:** review of feat/loading-screen, 2026-07-17 · **Priority:** P3

`view/boot-progress.ts` shows the step label and nothing else, so a multi-second load never confirms
*which* world is coming. A mis-clicked map means waiting out the whole load to find out. The genre
convention for an RTS/econ-sim loading screen is to name the world — often with its preview image and
player roster — and the data is already in hand where the card is mounted: `entries/map.ts` has the map
id and `script.players` (roster + team colours), `entries/scene.ts` has the scene's localized title from
`messages().scene`, and `entries/menu/map-preview.ts` already renders map previews for the menu.

Source basis: convention, not the original — decide against the original's own loading screen if that is
cheap to observe, and say which way it went.

## Scope

- An optional title on `mountBootProgress` (the map/scene name), rendered above the bar.
- Consider the preview image and roster/colour strip as a second step — the menu already builds both, so
  the cost is wiring, not new art. Weigh against the ~1 MB backdrop the card already fetches.
- Keep the card's degradation intact: a map with no name or no preview must still show the bar.

## Verify

- `npm test` + `npm run check` + `npm run build`.
- `npm run dev` → `?map=<id>` and `?scene=<id>`: the world is named while it loads; a nameless/preview-less
  map still loads cleanly. Human sign-off on the layout and on how much belongs on the card.
