# Render authored eat and sleep sequences for every settler body

**Area:** app · **Priority:** P3

Eat and sleep now draw through the original's `[gfxanimatomic]` per-tick frame lists
(`content/settler-gfx/character-specs.ts` `dirListAtomics`), so an action plays its authored shape
once instead of replaying the raw sprite strip. Three gaps remain, all because the extracted lists
don't cover those bodies:

- **No action-10 (eat) list for the woman or either child body.** `gfxAtomics` action 10 covers only
  `human_man_generic_eat` and the five warrior bodies. So `human_woman_generic_eat`,
  `human_child_boy_generic_eat` and `human_child_girl_generic_eat` keep the plain `atomics` fallback
  and still cycle their strip for the whole 50-tick meal.
- **The warrior specs bind no eat/sleep clip at all**, though `gfxAtomics` carries lists for every
  warrior body (`human_man_warrior_empty_sleep` 237, `_eat` 35, and the spear/sword/bow variants).
  A soldier eating or sleeping currently holds its wait pose.
- **Length mismatches** where a list does exist: the woman's sleep list is 64 entries against a
  100-tick atomic (she holds the last stance for the tail), the boy's is 119 against 100 (his
  get-up is cut off). The civilist's 237/237 is the only exact pair.

Check first whether the missing lists are absent from the original data or merely not extracted —
`tools/asset-pipeline` and the `[gfxanimatomic]` source rows are the place to settle that. If they
are genuinely absent, the fallback needs to be a named approximation rather than the cycling strip.

**Source basis:** `gfxAtomics` in generated `ir.json`, extracted from the mod's `[gfxanimatomic]`
records; the per-job atomic lengths from `atomicanimations.ini`.

## Scope

- Fix extraction if the missing woman/child lists exist in the readable source; otherwise use a
  non-looping named fallback.
- Bind the existing warrior eat/sleep lists to warrior bodies.
- Preserve the current hold-last-frame behavior for short lists unless source evidence supports a
  different timing rule.

## Verify

- No sim behaviour changes — this is render-only, so no goldens move.
- `?anim&char=woman&filter=eat` / `&char=boy&filter=sleep` in the animation gallery, and a **human
  pass**: the motion must play once, not loop.
