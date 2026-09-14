# Resolve a settler's atomic clip through the data's `baseatomics` chain

**Area:** sim, app · **Focus:** clip join · **Priority:** P2

`atomicClipName` and `atomicDuration` (`packages/sim/src/systems/readviews/animations.ts`) resolve an
atomic's animation as "the settler's own `setatomic` row, else the tribe's civilist row". The engine's
rule is a per-job parent chain: `jobtypes.ini` `baseatomics` is 6 only for the civilian trades, 31 for
armed soldiers, 33-41 for the hero bodies, and **48 (`adult_animal`) for wildlife**. The IR already
carries it as `JobType.baseJob`, and `@open-northland/data` already walks it (`resolveJobAtomics`,
covered by `packages/app/test/content/job-atomics.test.ts`).

Byte evidence (owned macOS `the original`, `an original routine`): the tribe table is
read for `(tribe, job, atomic)`; on a miss the job record's base job is loaded, its allow flag for the
atomic is required, and the lookup retries up the chain. A chain that never resolves starts no
animation at all, where the sim runs `DEFAULT_ATOMIC_DURATION` instead.

Two consequences, verified against the owned copy:

- **No animal resolves any clip.** `addWildlife` mints wildlife as a `Settler` with `jobType: null`, so
  `boundAtomicAnimation` returns nothing and the civilist fallback is deliberately withheld from beasts.
  The mod binds animal atomics under jobs 48/49 (`content/ir.json` tribe 20 `wolves` carries
  `{jobType: 48|49, atomicId: 81, animation: 'animal_bear_attack'|'animal_wolve_attack'}`). So a wolf's
  attack takes the 4-tick unresolved default instead of its clip's length, and its authored roar
  (`Wolve Attack` 104, `Bear Attack` 101, `Lion Attack` 107) never sounds - the generic
  `byEvent.combatSwing` swoosh covers it instead.
- **The sandbox binds no animal atomics at all** (`packages/app/src/game/sandbox/content/catalog/tribes.ts`
  registers animal tribes with `typeId`/`id` only), so the scene cannot exercise the fix.
- **A struck working trade never flinches.** The stagger gate
  (`packages/sim/src/systems/settlers/atomics/effects/combat/hit/stagger.ts`) requires the trade's own
  `attacked` (82) row, which only jobs 5-6 carry; under the chain a builder or carrier would resolve the
  civilist's. Whether the original issues 82 to a hit civilian trade still needs observation.
- The sandbox binds the store pick-up and pile-up (22/23) for every job, unlike the real data (22 on
  jobs 1-6, 23 on 5-6), so no scene walks the fallback the real content depends on; binding them on the
  civilist only, as the talk and eat rows already do, would make scenarios follow the real path.

## Scope

- Give the sim the job's real atomic parent chain instead of the civilist flattening, and a wildlife body
  the job its tribe binds its clips under.
- Add the sandbox animal attack clips and their tribe bindings so `?scene=wildlife` can be judged. Their
  lengths are a swing-cadence change, so check the combat tests that pin animal attack timing.
- Drop the approximation note on `atomicClipName` once the chain is real.

## Verify

- Unit: a soldier resolves through job 31, a hero through its own parent, and a bear through 48 - each to
  the clip the data names, not the civilist's.
- Human ear on `?scene=wildlife`: a bear and a wolf attack with their own roars, at their own cadence.
