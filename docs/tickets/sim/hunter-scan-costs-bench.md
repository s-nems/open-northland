# Bench the hunter's per-tick scan costs before bounding them

**Area:** sim · **Priority:** P3

Four hunter and wildlife scans are unmeasured. Bench them on a wildlife-rich, resource-dense ground
with posted hunters, plus archer volleys for the first case, before optimizing them.

## Scope

- `frightenWildlifeNear` (`conflict/fright.ts`): a linear pass over all map wildlife per ranged
  launch; a wildlife candidate list off the combat index walk would bound it under volleys.
- `huntingGroundHoldsCarcass` (`conflict/hunting/kill-claim.ts`): an actively chasing hunter re-probes the
  carcass gate each tick, and a carcass-less probe tests every indexed resource in the
  `HUNTER_WORK_FLAG_RADIUS`+slack box - a resource-dense ground pays the full box per chase tick. A hit
  that survives the cheap rejects and is a carcass also resolves its killer's stance, failed-route memo
  and ground (`claimedByAnotherHunter`, measured ~1.5 us/call, bounded by carcasses-in-ground).
- The prey-claim set (`preyHeldByOthers`, `conflict/hunting/spec.ts`): a Set over every holding hunter,
  rebuilt per hunting hunter per acquisition tick - O(hunters²) map reads and one allocation per hunter
  per tick. Measured at ~0.008 ms/tick for 10 holders and ~1.9 ms/tick for 120, so it is bounded by
  hunter count rather than map size; `World.componentGeneration(HuntFocus)` would key a per-world memo
  at O(H) while keeping the intra-tick visibility the rule depends on.
- The hunter's two-tier `resolveTarget` when only last-resort livestock remains in ground: the tier-1
  `nearest` walks the whole `dist+radius` band with zero accepts before the fallback finds the sheep,
  and `HuntRest` never rests it since the search succeeds. A `HuntFocus` hold skips the fallback tier,
  but a held last-resort target still pays that tier-1 walk every chase tick for the preemption check -
  so this case is unchanged; a hold on normal game skips both.
- The employed roamer's banked-form good filter (`drives/economy/gatherer.ts`): rebuilds a Set over all
  content goods per plan call for every building-employed gatherer - a steady planner-path allocation;
  memoize per (content, workplace stock shape) if it shows.

## Verify

`npm run bench:compare` before/after on the chosen scenario, idle box, per `docs/DEVELOPMENT.md`; no
golden movement (pure cost work).
