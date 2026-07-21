# Observe and resolve typographic-quoted `setproducedgood` values

**Area:** pipeline · **Priority:** P3

**Needs user:** the deciding evidence is the running original (an agent cannot self-sign it).

The map `saracen_1_sub_2` authors 86 of its 104 collector picks with Polish typographic quotes —
`setproducedgood „gold”` — beside 18 plain `setproducedgood "gold"` in the SAME file (so this is authoring,
not a decode artifact: a codepage fault would have hit all 104 uniformly). It is the only such map;
733 of the corpus's 819 picks resolve cleanly, and these 86 are the entire remainder.

The decoder keeps names verbatim, the loader's name join finds no `„gold”` good, so those 86 collectors
fall back to gather-everything (`packages/app/src/slice/authored-placements.ts`, counted in
`droppedGoods`). That is the current, deliberate behavior — this ticket only decides whether it is the
FAITHFUL one.

## Investigate

- **The deciding question:** does the original's tokenizer strip `„…”`, or does it also fail the goodtype
  lookup and leave those collectors on the default? Our ASCII-quote-stripping grammar suggests the
  original fails too (its parser is unlikely to know Polish smart quotes), but that is an inference, not
  evidence.
- Source basis to settle it: load `saracen_1_sub_2` in the running original and look at whether those
  collectors are set to gold or to everything.

## Scope

- If the original strips them: normalize typographic quotes in the `.cif`/`.inc` grammar
  (`tools/asset-pipeline/src/decoders/ini/grammar.ts`), not in the map decoder — it is a tokenizer
  concern, and other verbs on other maps may carry the same shape (grep before assuming this verb is
  the only victim).
- If it does not: leave the behavior and record the finding as a short source-basis note in
  `extractStaticObjects`, so the next reader does not "fix" a faithful drop.

## Verify

- `npm run test:pipeline`; then re-count resolved picks against `content/maps/*.json` (819 authored,
  733 resolving today — a normalization must move that to 819 and move nothing else).
