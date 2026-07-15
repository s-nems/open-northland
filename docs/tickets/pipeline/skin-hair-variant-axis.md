# Investigate the per-tone skin/hair variant axis for settler sprites

**Area:** pipeline (+ render) · **Origin:** gap-analysis audit 2026-07-13 (filing the deferred
follow-up named in packages/app/AGENTS.md) · **Priority:** P3

`packages/app/AGENTS.md` (~lines 117-121, the `?view=colors` entry) documents player/team
recolouring — the indexed character atlas drawn through the `256×16` player-colour LUT via
`render`'s `PalettedSprite`, where "only the clothing band recolours" — and then states verbatim:
"A per-tone **skin/hair variant** axis (distinct from team colour) is still a deferred pipeline
follow-up; file it as a `docs/tickets/` ticket before implementing." This is that ticket. Today
every settler of a tribe shares one skin/hair appearance; only the clothing band varies by player.

**Investigate first — the mechanism is pinned, the variant axis is not.** The primary source is
readable: skin/hair are palette remaps driven by `randompalette.ini`
(`Data/engine2d/inis/humans/randompalette.ini`, ~299 `[RandomPalette]` recipes) — already asserted
at `packages/app/src/catalog/roster.ts:14` and partially consumed by
`tools/asset-pipeline/src/decoders/player-palette.ts` (which parses only the `player_00…09`
recipes). What is NOT yet known is how the non-player recipes select per-settler skin/hair
variants. Evidence to check, in order:

1. `randompalette.ini` itself — enumerate the non-player `[RandomPalette]` recipes: which palette
   bands they patch (skin? hair?), and what selects a recipe per settler.
2. The `.hlt` lighting/remap tables (242 files) and their decoded byte patterns: determine how the
   recipes affect palette bands and whether another owned data file selects a variant per settler.
3. The decoded character palettes/LUT the pipeline already emits — does the indexed atlas reserve
   distinct skin and hair palette bands (the way it reserves the clothing band), or are tones baked
   into the pixels?
4. Observed original behavior: do settlers in the original visibly vary in skin/hair within one
   tribe at all? If not, this axis may be a non-feature — deleting this ticket with that finding is
   a valid outcome (say why in the commit).

## Scope

1. Run the investigation above; write down what the variant axis actually is (palette bands + remap
   rows + selection rule) with source basis.
2. If real and tractable: extend the pipeline's palette-LUT emission with the skin/hair rows and
   file (or implement, if it fits the session) the render/sim side — a deterministic per-settler
   variant pick (seeded RNG in the sim, never `Math.random`) feeding `PalettedSprite` row selection
   alongside team colour.
3. If large: deliverable is the decoded mechanism + follow-up tickets (pipeline lane, render
   consumption, sim variant assignment). Update the `packages/app/AGENTS.md` wording that points at
   filing this ticket once it exists/lands.

## Verify

- Investigation findings carry named evidence from readable files, decoded-data proof, a published
  specification, or observed behavior.
- If implemented: `?view=colors`-style gallery check that team colour and skin/hair vary
  independently and clothing-band recolouring is unchanged — **user's eyes**; pipeline run against
  the owned game copy; `npm test`, `npm run check`, `npm run build`.
