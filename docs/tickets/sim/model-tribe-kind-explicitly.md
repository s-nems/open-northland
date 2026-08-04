# Give the tribe kind an explicit field instead of deriving it from two absences

**Area:** data, pipeline, sim · **Focus:** content · **Priority:** P3

The animal half of this is done: `isAnimalTribe` (`systems/readviews/tribes/animals.ts`) now reads the
`[animaltype]` record rather than an empty `jobEnables`, so the progression graph no longer decides what
is wildlife.

The other two kinds are still derived, each from an absence:

- a civilization is `jobEnables.length > 0` (`isPlayableTribe`), so an authored civilization with no
  progression edges is not playable and, through `declaresNoTrades`, silently loses its need bars;
- a monster is "no animal record **and** no tech graph" - never named in content, only reachable by
  pairing the `Person` key with `declaresNoTrades`.

## Scope

- Carry the kind (`civilization` | `animal` | `monster`) as a validated content field. Animal membership
  comes from the animal table; the two monster tribes are `TRIBE_TYPE_HUMAN_*` in
  `GameSourceIncludes/logicdefines.inc` (5 weresnake, 6 werewolf).
- Move `isPlayableTribe` and `declaresNoTrades` onto the kind, leaving `jobEnables` responsible only for
  unlocks.
- Preserve current corpus behavior; name any mechanic change that falls out.

## Verify

- Content tests pin every extracted tribe into exactly one kind. A synthetic no-tech civilization keeps
  its needs, jobs, and experience.
- `npm run test:pipeline`, `npm run test:content`, `npm test`, `npm run check`, `npm run build`.
