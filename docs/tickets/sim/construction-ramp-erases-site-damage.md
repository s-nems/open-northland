# Stop the construction ramp from erasing damage dealt to a site

**Area:** sim · **Priority:** P2

`advanceSite` calls `setHealth(world, e, building.built)` every tick for a non-upgrading site
(`systems/economy/construction.ts`), and `setHealth` assigns `hitpoints = built · max` outright rather
than raising a floor. A from-scratch site's hitpoints are therefore a rewritten copy of `built`, and any
damage taken is discarded on the next construction pass.

The schedule (`systems/schedule.ts`) runs `atomic` before `construction`, so a melee hit landed this tick
is gone before `cleanup` can see it. `projectile` runs after `construction`, so **arrow damage reaches
`cleanup` and melee damage never does** - and a just-placed foundation is stamped at 1 hitpoint
(`systems/command/placement.ts`), which `cleanup` already routes to `razeBuilding`, so one arrow razes it
outright while a warband cannot touch it.

The ramp itself is sound - it exists so a foundation is not a 0-HP corpse. The defect is that it owns the
pool absolutely instead of owning only the build's contribution to it.

## Scope

- Let a rising site keep damage: the ramp should raise the pool toward `built · max` without discarding
  a lower current value, or track the build contribution separately from combat losses.
- Keep the existing floor (a foundation never reaches 0 HP through the ramp alone) and the upgrade-site
  exemption (`Upgrading` already skips the ramp) unchanged.
- Keep the current outcome for a site driven to 0 by combat: `cleanup` razes it through `razeBuilding`,
  the same seam a finished building uses. Melee must reach that outcome too, not gain a new one.
- Do not change what a finished site's `Health` becomes on completion (full pool).
- Delete the stale sentence in `setHealth`'s JSDoc claiming combat targeting of buildings "is a later
  slice, so a building only ever rises through this ramp today" - `razeBuilding` handles it today.

## Verify

Sim tests for a damaged rising site: a melee hit landed before the construction pass survives it, a
melee-drained site is razed exactly like an arrow-drained one, and an intact site still ramps as now.
Run `npm test`, `npm run check`, and `npm run build`; name any intentional golden hash change.

The details panel needs no change: its general-section health gauge already draws whatever pool the sim
leaves on a site, and the Construction window draws build progress only.
