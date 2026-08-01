# Bench the hunter's per-tick scan costs before bounding them

**Area:** sim · **Priority:** P3

Four hunter and wildlife scans are unmeasured. Bench them on a wildlife-rich, resource-dense ground
with posted hunters, plus archer volleys for the first case, before optimizing them.

## Scope

- `frightenWildlifeNear` (`conflict/fright.ts`): a linear pass over all map wildlife per ranged
  launch; a wildlife candidate list off the combat index walk would bound it under volleys.
- `huntingGroundHoldsCarcass` (`conflict/hunting-ground.ts`): an actively chasing hunter re-probes the
  carcass gate each tick, and a carcass-less probe tests every indexed resource in the
  `HUNTER_WORK_FLAG_RADIUS`+slack box - a resource-dense ground pays the full box per chase tick.
- The hunter's two-tier `resolveTarget` when only last-resort livestock remains in ground: the tier-1
  `nearest` walks the whole `dist+radius` band with zero accepts every chase tick before the fallback
  finds the sheep (`HuntRest` never rests it, since the search succeeds).
- The employed roamer's banked-form good filter (`drives/economy/gatherer.ts`): rebuilds a Set over all
  content goods per plan call for every building-employed gatherer - a steady planner-path allocation;
  memoize per (content, workplace stock shape) if it shows.

## Verify

`npm run bench:compare` before/after on the chosen scenario, idle box, per `docs/DEVELOPMENT.md`; no
golden movement (pure cost work).
