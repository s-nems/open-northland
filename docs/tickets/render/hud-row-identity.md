# Tag the HUD's volatile row instead of letting app hardcode its index

**Area:** render, app · **Origin:** /refactor-cleanup on packages/render, 2026-07-17 · **Priority:** P3

`data/hud/` `layoutHud` returns `HudLayout.rows` as a flat list of `{x, y, text}` with no row identity.
`layoutHud` alone knows row 0 is the volatile `Tribe N · tick T` line — the one that changes every
tick. app encodes that out-of-band:

```ts
/** The index of `layoutHud`'s volatile `Tribe N · tick T` row — excluded from the change key. */
const TICK_ROW = 0;
```

(`app/src/hud/tool-panel/stats-window.ts`), then skips `i = TICK_ROW + 1 ..` to build its per-frame
change-detection key. The app comment even reasons about why it uses an index rather than a substring
match — the tell that the *renderer* should have handed it the fact.

Any future reordering in `layoutHud` (a title row, population above the tick) silently defeats app's
rebuild guard and re-rasterizes hundreds of glyph meshes every frame. Nothing catches it: no test pins
row 0's identity.

## Scope

Tag the row at its source: `readonly volatile?: boolean` on `HudTextRow`, set only on the tribe/tick row
in `layoutHud`. app's `refresh` filters `!r.volatile` and `TICK_ROW` disappears. (A `readonly role:
'tick' | 'heading' | 'tally'` discriminant is the shape to reach for only if a second consumer needs
to distinguish more than volatile-vs-stable.)

Pin with a test that the tick row is the only volatile one.

## Verify

`npm test`, `npm run check`, `npm run build`. Behaviour-preserving — the change key's content stays
identical for today's layout, so the guard behaves the same; the point is that it keeps behaving the
same after a layout edit.
