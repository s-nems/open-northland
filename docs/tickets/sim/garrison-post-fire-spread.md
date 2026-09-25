# Fan a tower's POSTED archers across their targets

**Area:** sim · **Priority:** P2

A defence-mode building picks each shot among the nearest few enemies (`conflict/shelter-fire.ts`). A
tower's EMPLOYED archers (`conflict/tower-post.ts`) do not: they all stand on the tower's node with the
same accept filter, so each resolves the same single nearest man. A full big tower posts 12, which means
twelve arrows into one raider while the rest of the warband walks up untouched.

A spread needs a dense seat index per building: the numbering would have to run over the `Garrison`
carriers of one building, in canonical order, and only over those actually standing at their post.

## Scope

- Number the posted archers of a building in canonical order and hand each its own share of a
  `CombatIndex.nearestFew` band in `engageSpec`'s post branch.
- One shared numbering pass per combat tick, not one per shooter.

## Verify

- `packages/sim/test/conflict/tower-garrison.test.ts` - a tower with several archers draws on several
  raiders in the same tick.
- `?scene=tower-garrison` - **user's eyes** (arrows leaving toward more than one attacker).
