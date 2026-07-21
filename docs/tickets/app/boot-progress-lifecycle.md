# Show honest loading progress without slowing fast boots

**Area:** app · **Priority:** P3

The loading card mounts only after the JavaScript bundle executes, then every phase forces a paint.
Slow boots therefore begin with a blank page, while fast fallback-content boots flash a card and pay
several needless frame waits. Once visible, the bar also stalls during the long terrain, object, and
sprite-sheet loads even though those loaders know their item counts.

## Scope

- Put an adoptable loading shell in `index.html`, but reveal it only after a short CSS/JS delay; a boot
  that finishes first removes it without mounting or yielding.
- Make non-playable entries remove the shell before drawing so `?shot`, menus, and galleries cannot
  inherit it.
- Let the terrain, object, and sprite-sheet loaders report optional `done/total` progress and interpolate
  within the active phase. Keep the loaders independent of the view through a callback.
- Do not invent fixed phase weights. Count real work where possible and leave uncountable phases discrete.

## Verify

- A throttled `?map=` load shows the card from the first useful paint and advances through long phases.
- A bare-checkout `?scene=` boot shows no flash and adds no forced-frame delay.
- `npm run shot` is byte-identical; `npm test`, `npm run check`, and `npm run build` pass.

