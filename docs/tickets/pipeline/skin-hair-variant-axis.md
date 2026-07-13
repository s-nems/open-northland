# Investigate the per-tone skin/hair variant axis for settler sprites

**Area:** pipeline (+ render) · **Origin:** gap-analysis audit 2026-07-13 (filing the deferred
follow-up named in packages/app/AGENTS.md) · **Priority:** P3

`packages/app/AGENTS.md` (~lines 117-121, the `?view=colors` entry) documents player/team
recolouring — the indexed character atlas drawn through the `256×16` player-colour LUT via
`render`'s `PalettedSprite`, where "only the clothing band recolours" — and then states verbatim:
"A per-tone **skin/hair variant** axis (distinct from team colour) is still a deferred pipeline
follow-up; file it as a `docs/tickets/` ticket before implementing." This is that ticket. Today
every settler of a tribe shares one skin/hair appearance; only the clothing band varies by player.

**Investigate first — how the original encodes skin/hair tones is unknown here.** Candidate
evidence to check, in order:

1. `OpenVikings_reversing` remap machinery — `NXBasics/CRemapTable.cs` and the `.hlt`
   lighting/remap tables (242 files, docs/SOURCES.md) are the plausible mechanism; check whether
   remap rows beyond the 16 player colours exist for skin/hair bands, and how the original picks a
   variant per settler (`CBobManager`/creature setup paths).
2. The decoded character palettes/LUT the pipeline already emits — does the indexed atlas reserve
   distinct skin and hair palette bands (the way it reserves the clothing band), or are tones baked
   into the pixels?
3. Observed original behavior: do settlers in the original visibly vary in skin/hair within one
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

- Investigation findings carry named evidence (file + symbol in OpenVikings, or decoded-data proof,
  or observed behavior).
- If implemented: `?view=colors`-style gallery check that team colour and skin/hair vary
  independently and clothing-band recolouring is unchanged — **user's eyes**; pipeline run against
  the owned game copy; `npm test`, `npm run check`, `npm run build`.
