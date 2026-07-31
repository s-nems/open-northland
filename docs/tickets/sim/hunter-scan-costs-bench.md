# Bench the hunter's per-tick scan costs before bounding them

**Area:** sim · **Priority:** P3

Three hunter/wildlife-shaped scans are honest-but-unmeasured. Bench them on a wildlife-rich,
resource-dense ground with posted hunters (and archer volleys for the first) before optimizing any of
them - the successor of the executed combat-spatial ticket's "adjacent candidates" note (`ba93cb31`
merged the index/presence walk).

- `frightenWildlifeNear` (`conflict/fright.ts`): a linear pass over all map wildlife per ranged
  launch; a wildlife candidate list off the combat index walk would bound it under volleys.
- `huntingGroundHoldsCarcass` (`conflict/hunting-ground.ts`): an actively chasing hunter re-probes the
  carcass gate each tick, and a carcass-less probe tests every indexed resource in the
  `HUNTER_WORK_FLAG_RADIUS`+slack box - a resource-dense ground pays the full box per chase tick.
- The hunter's two-tier `resolveTarget` when only last-resort livestock remains in ground: the tier-1
  `nearest` walks the whole `dist+radius` band with zero accepts every chase tick before the fallback
  finds the sheep (`HuntRest` never rests it, since the search succeeds).

## Verify

`npm run bench:compare` before/after on the chosen scenario, idle box, per `docs/DEVELOPMENT.md`; no
golden movement (pure cost work).
