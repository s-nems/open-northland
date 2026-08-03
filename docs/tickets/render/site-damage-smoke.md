# Draw damage smoke on a besieged construction site

**Area:** render · **Focus:** scene/snapshot-readers · **Priority:** P3

`readHpFraction` (`packages/render/src/data/scene/snapshot-readers/static-readers.ts`) returns
`undefined` for every building with `built < ONE`, so a site never drives the damage-smoke overlay. Its
reason - "its pool ramps with the build, a site would read damaged forever" - held while the
ConstructionSystem assigned `hitpoints = built · max`: the pool was a copy of `built`, so every rising
site read as damaged. The ramp now only adds what the build gained, so a site's pool carries real siege
damage and a half-built house can stand for many blows with no map-level cue (the details panel's health
gauge already shows it).

## Scope

- Read a site's damage against its build ceiling (`Building.built · Health.max`, the sim's
  `poolCeiling`) instead of `Health.max`, so an undamaged rising site still returns `undefined`.
- Keep the finished-building path and the upgrade-site exemption (an upgrading building keeps its
  standing pool while `built` restarts at 0) unchanged.

## Verify

Snapshot-reader unit tests: an undamaged site at any `built` reads `undefined`, a battered one reads its
fraction, an upgrading building is unchanged. Human seam: `?scene=siege`, watch a mid-build enemy
structure take hits and confirm the smoke appears and sheds as it would on a finished house.
