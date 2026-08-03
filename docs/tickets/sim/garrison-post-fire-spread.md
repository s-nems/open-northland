# Fan a tower's POSTED archers across their targets too

**Area:** sim · **Priority:** P2

The sheltering crowd fans its fire across the nearest few attackers (`GARRISON_SPREAD_TARGETS`, keyed on
each claimant's seat from `defence/manning.ts`). A tower's EMPLOYED archers (`conflict/tower-post.ts`) do
not: they all stand on the tower's node with the same accept filter, so each resolves the same single
nearest man. A full big tower posts 12, which means twelve arrows into one raider while the rest of the
warband walks up untouched - the exact stacking the fan was added to stop.

The spread needs a dense seat index per building, which the claimants get from `garrisonSeats`. A post
has no equivalent: the numbering would have to run over the `Garrison` carriers of one building, in
canonical order, and only over those actually standing at their post.

## Scope

- Number the posted archers of a building the way `garrisonSeats` numbers its claimants, and hand each
  its own share of the `nearestFew` band in `engageSpec`'s post branch.
- One shared numbering pass per combat tick, not one per shooter.
- The two garrisons hold separate seats (see `catalog/defence.ts`), so the two indexes stay separate.

## Verify

- `packages/sim/test/conflict/tower-garrison.test.ts` - a tower with several archers draws on several
  raiders in the same tick, as the defence-mode test pins for the sheltering crowd.
- `?scene=tower-garrison` - **user's eyes** (arrows leaving toward more than one attacker).
