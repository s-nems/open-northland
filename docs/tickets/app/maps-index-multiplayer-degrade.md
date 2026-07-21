# A malformed `[multiplayer]` node silently serves a wrong roster

**Area:** content-resolver · **Origin:** content-resolver + desktop cleanup review, 2026-07-17 · **Priority:** P3

`multiplayerOf` (`packages/content-resolver/src/maps-index.ts`) returns `NO_MULTIPLAYER` for any
`multiplayer` node that is not an object, and `continue`s past any `slotOptions` row whose `player`
is not a number or whose `allowed` is not an array. The roster is then still served from an empty
lobby table.

That degrade is wrong in a way the file's other degrades are not. A malformed `players` array or an
unreadable sidecar drops the whole roster, so the menu shows a map with no slots and a human notices.
A malformed `multiplayer` node instead serves a **plausible but incorrect** roster:

- `claimable` falls back to `type === 'human'`, so the 45 authored-`ai` slots across 18 maps that the
  lobby opens to human (`specjalna_forteca`, `specjalna_mosty_na_rzece`,
  `multiplayer_201_special_coop`, …) become unseatable.
- `aiAllowed` falls back to `true`, so the 47 Human/Closed-only rows across 15 maps grow a bogus
  Idle/AI toggle.

Counts verified against the 125 decoded `.script.json` sidecars in `content/maps` (2026-07-17).

The asymmetry is deliberate for the *sidecar* level (a non-object `.meta.json` warns, a non-object
`.script.json` degrades silently) and is pinned by tests. This ticket is only about the node one
level down: a `multiplayer` key that is *present but unparseable* means the map author did write a
lobby table, so silently reading it as "no table" discards known-authored data.

Pre-existing on `main`; left alone by the cleanup pass because fixing it changes observable behavior.

## Scope

- Warn (like the meta reader does) when `multiplayer` is present but not an object, and when a
  `slotOptions` row is present but has the wrong type. An absent table stays silent because most maps
  do not provide one.
- Decide and record whether a present-but-unparseable table should also drop the roster rather than
  serve it against an empty table. Dropping is the safer read of "never serve a wrong roster", but it
  is a player-visible change (the map loses its slot list), so it needs the user's call.
- Extend `packages/content-resolver/test/maps-index.test.ts`, which already covers the malformed-meta
  and malformed-script cases but not a malformed `multiplayer` node.

## Verify

- `npm test` with new cases for the warning and chosen fallback.
- `npm run test:content` with a local `content/`, to confirm no real map trips the new warning.
