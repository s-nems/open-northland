# Give animals their authored run gait

**Area:** sim, app · **Focus:** animals · **Priority:** P3

Wolves and lions author a second unloaded `[gfxwalkatomic]` row (`..._run` / `..._running`, a faster
`logicwalkspeed` than the walk), and chickens author a faster row too. The sim has one pace per unit
(`packages/sim/src/systems/readviews/tribes/animals.ts` does not surface `runspeed`), and
`animalWalkSeqName` (`packages/app/src/content/animal-gfx/bindings.ts`) keeps the first row, so the run
never plays. Maps place about 1180 wolves, 180 lions and 260 lionesses.

## Scope

- Investigate first when the original switches an animal to its run speed (hunting, fleeing, attack
  approach), using the readable `animaltypes.ini` fields and the walk rows' speeds. Write down the
  basis.
- Add the run as a movement mode in the sim, from the IR's `runspeed`, for the cases found. It changes
  the sim, so move the goldens in the same commit.
- Bind the run row as a second gait in the animal binding and pick it from the movement mode.

## Verify

- Sim test: a wolf in a run case covers ground at the run speed, and a grazing wolf at the walk speed.
- App test: the run gait binds for wolves and lions.
- Browser: a wolf pack chasing prey plays the run cycle.
