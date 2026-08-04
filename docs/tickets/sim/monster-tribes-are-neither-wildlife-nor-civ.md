# Decide what the monster tribes are under the personhood split

**Area:** sim · **Priority:** P1

`isAnimalTribe` now reads the `[animaltype]` record, so weresnake (tribe 5) and werewolf (tribe 6) are
no longer wildlife: `logicdefines.inc` declares them `TRIBE_TYPE_HUMAN_*` and `animaltypes.ini` gives
them no record. The decoded maps place them as `sethuman` records - 1905 weresnakes and 436 werewolves
across `content/maps/` - so they reach `createSettler`, pass its animal-tribe rejection, and are minted
as `Person`.

Under the old empty-tech-graph predicate they read as animals and were skipped by every human system.
As `Person` they are inside all of them, and three consequences are unverified:

- `needsSystem` sweeps them. `HUNGER_RISE_PER_TICK` fills a bar in 9600 ticks and
  `STARVATION_BITES_TO_DIE * STARVATION_DAMAGE_INTERVAL_TICKS` is 2400 more, so a monster with no way to
  eat dies about 17 minutes into a 1x run. Whether the eat drive can feed one (no tribe stores, no
  workplace) is not measured.
- They join every other `Person` sweep: the marriage search, the gossip pool, and the operator node
  index each carry 2341 more entities per tick than before.
- `mayAttack` reads them as a civilization, so every monster is now an enemy of every other tribe.
  Plausibly more faithful than the old inert-decoration behavior, but nothing pins it.

## Scope

- Measure first, on a real map (`saracen_4_sub_1` has both tribes): monster count over ~13000 ticks,
  peak hunger, and cause of death. A probe under `packages/app/test/content/` answers all three.
- Then decide the classification. A third state (monster: no needs, no trade, keeps the hostility) is
  the likely shape; `Person` currently means "member of a civilization" in its own doc, which a
  weresnake is not.
- Whatever lands, `personhoodMatchesTribe` must state the rule for all three tribe classes, not two.

## Verify

- `npm run check`, `npm run build`, `npm test`, plus `npm run test:content` for the real-map probe.
- The golden state hash moves if monsters gain or lose a component; `GOLDEN_TRACE` and `run.produced`
  must not move unless the decision is deliberately a mechanic change.
