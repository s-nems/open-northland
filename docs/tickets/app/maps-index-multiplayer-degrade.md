# Reject malformed multiplayer roster data

**Area:** content-resolver · **Priority:** P3

`multiplayerOf` (`packages/content-resolver/src/maps-index.ts`) returns `NO_MULTIPLAYER` for any
`multiplayer` node that is not an object, and `continue`s past any `slotOptions` row whose `player`
is not a number or whose `allowed` is not an array. The roster is then still served from an empty
lobby table.

Unlike an absent table, malformed data means the author supplied a roster that the loader failed to
understand. Falling back serves a plausible but incorrect roster:

- `claimable` falls back to `type === 'human'`, so the 45 authored-`ai` slots across 18 maps that the
  lobby opens to human (`specjalna_forteca`, `specjalna_mosty_na_rzece`,
  `multiplayer_201_special_coop`, …) become unseatable.
- `aiAllowed` falls back to `true`, so the 47 Human/Closed-only rows across 15 maps grow a bogus
  Idle/AI toggle.

Counts verified against the 125 decoded `.script.json` sidecars in `content/maps` (2026-07-17).

## Scope

- Warn when `multiplayer` is present but invalid, including malformed `slotOptions` rows. An absent
  table stays silent because most maps do not provide one.
- Drop the affected roster instead of inventing defaults from data known to be malformed.
- Extend `packages/content-resolver/test/maps-index.test.ts`, which already covers the malformed-meta
  and malformed-script cases but not a malformed `multiplayer` node.

## Verify

- `npm test` with new cases for the warning and dropped roster.
- `npm run test:content` with a local `content/`, to confirm no real map trips the new warning.
