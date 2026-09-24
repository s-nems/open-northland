# Move the human-only halves of `Settler` off the shared component

**Area:** sim · **Priority:** P3

`Settler` is the shared creature component: people and wildlife both carry it, and the `Person` marker
(`components/settler.ts`) is what separates them. Four of its six fields are human-only, though -
`hunger`, `fatigue`, `piety`, `enjoyment` - and so is the `SettlerProgress` experience map both
constructors stamp beside it. `addWildlife` writes them all as inert zeros or an empty map, nothing
raises them (`systems/lifecycle/needs/system.ts` sweeps `Person`), nothing reads them
(`systems/progression/experience.ts` returns early on wildlife), and `hashSimState` mixes them for
every creature on the map. A monster-tribe person carries the same inert fields: `needsSystem`
skips a recorded tribe with no `jobEnables`, because no building can employ it.

Making them human-only components drops the dead fields per creature out of the hash, and turns the
two remaining conventional gates structural: `grantFightExperience` still asks `isWildlife` at
runtime, where an XP grant keyed on `SettlerProgress` could not reach a creature at all, and
`needsSystem` still asks `declaresNoTrades` per entity, where the stamp could answer it once. `tribe`
and `jobType` stay shared - `conflict/weapons.ts` reads a creature's null `jobType` to pick its animal weapon.

## Scope

- Extract `Needs { hunger, fatigue, piety, enjoyment }` off `Settler` and stop `addWildlife` stamping
  `SettlerProgress`; keep the two constructors as the only stamp path, and stamp `Needs` only for a
  tribe that declares trades. A creature's swing reads no experience then (`engage-combatant.ts`).
- Retarget `needsSystem`, `experience.ts`, `alive-jobs.ts` and the `needsInRange` invariant at the new
  components, and drop the `Person` requirement where the new component already implies it.
- The state hash moves (fewer hashed fields per creature); the atomic trace must not.
- Optional in the same pass, decide separately: `Settler` now names the shared creature, not a person.
  Renaming it `Creature` is mechanical and behavior-free, but touches every query site, so it is worth
  doing only alongside a change that already reads those files.

## Verify

- `npm run check`, `npm run build`, `npm test`. Re-baseline the one golden state hash
  (`test/core/golden-trace.test.ts`) and confirm `GOLDEN_TRACE` and `run.produced` are untouched.
