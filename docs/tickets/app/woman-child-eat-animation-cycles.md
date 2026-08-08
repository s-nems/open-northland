# Name an approximation for the woman/child eat fallback

**Area:** app · **Priority:** P3

Every atomic with an extracted `[gfxanimatomic]` program now plays its authored frame lists, and the
warrior eat/sleep clips are bound. One verified gap remains: the source authors **no eat program
(action 9/10) for the woman or either child body** - checked against the mod's
`mapmoveableanimations/animations.ini`, which carries only their sleep rows (action 8). So
`human_woman_generic_eat`, `human_child_boy_generic_eat` and `human_child_girl_generic_eat` play the
strip fallback: the whole clip cycling facing-locked for the full 50-tick meal (the woman's 16-frame
clip about three times, the children's 27-frame clips about twice).

Decide and implement a named approximation instead of the cycling strip, e.g. play the strip once and
return to the first frame (the same overrun rule `frameOf` applies to one-shot lists - past the end
the sprite returns to entry 0, the ready stance; it does not hold the last frame).

## Scope

- Only the three eat fallbacks above; everything with an authored list already plays it.
- Keep the decision render-side; no sim timing changes.

## Verify

- `?anim&char=woman&filter=eat` in the gallery plus a **human pass**: the meal must not visibly loop.
