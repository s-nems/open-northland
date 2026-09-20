# Start an unpicked worker on its job's default good

**Area:** pipeline, data, sim, app · **Priority:** P3

A worker whose player has chosen nothing produces every good its workplace can make, in rotation
(`craftablePool`, `packages/sim/src/systems/economy/production/rotation.ts`). The original starts it
on one good: `tribetypes.ini` carries a `jobDefaultGood <job> <good>` line for every job of every
tribe (`DataCnmd/tribetypes12/tribetypes.ini`, 18 lines per tribe, e.g. `jobDefaultGood 16 58`), and
the house window is where the player widens or changes that pick.

Consequence, in the 15 buildings whose recipes make more than one good: a fresh joinery alternates
furniture, wooden tools and iron tools; a fresh animal farm breeds sheep **and** cattle, so its herd
grows to the 20 of each row rather than the 20 the manual describes. The player has no way to see
that "all of them" is not what the original would do.

## Scope

- Extract the key. `jobDefaultGood` is parsed in the tribe stage (`tools/asset-pipeline/src/stages/ir`
  builds `tribes[].jobEnables` from the same block); add the per-job default good beside it, bump
  `IR_VERSION`, and regenerate. Confirm the mod's own lines win over the base layer.
- Fall back to it in `craftablePool`: an operator with no `CraftSelection` takes its job's default good
  when the workplace makes it, and only then the all-products rotation (a job whose default the house
  does not make, or which content leaves unset, keeps today's behaviour).
- The panel's craft toggles already read the selection; check what the "All" line
  (`model/settler-work.ts`) should say when the default is the only good in play.
- The AI sets `CraftSelection` explicitly (`ai-player/workforce/craft.ts`), so it is unaffected; assert
  that in a test rather than assuming it.

## Verify

- A sim test per shape: no selection with a default, no selection without one, a selection that
  overrides the default.
- `npm run test:content`: the animal farm breeds one species for an unpicked breeder, and the herd
  settles at one row's cap.
- Golden hashes move once, intentionally.
