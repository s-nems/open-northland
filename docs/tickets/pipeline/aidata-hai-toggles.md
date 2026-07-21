# Extract [AIData] HAI toggles from map data and honor them in the AI player

**Area:** pipeline + sim · **Priority:** P3

Original maps configure the autonomous AI per player in `map.ini` `[AIData]` (scenario maps via an
`ai.inc` include, e.g. `CnModMaps/cn_2/ai.inc`): blanket `HAI_Disable <player>` plus per-module
`HAI_Disable{CollectResources,GuideBuild,HomeExpansion,HouseBuild,HouseUpgrade,Military,RoadBuild}`
(vocabulary confirmed in `Game.exe` strings). Free-play maps ship an empty `[AIData]`, meaning
full HAI for AI-type players. Honoring these toggles makes imported scenario maps behave as
authored because their choreographed garrisons stay static instead of sprouting an economy. The scripted
`AI_MainTask_*`/`AI_SetCondition_*` layer in the same section stays out of scope.

## Scope

1. Pipeline: parse the `HAI_*` lines of `[AIData]` into the map IR as per-player module-disable
   flags (investigate first: whether the section reaches the current map decode path or needs a new
   `.ini` include walk. `.ini` keys are case-sensitive, and the shipped section header is lowercase
   `[aidata]`).
2. Sim: map those flags onto the AI-player scaffold's per-module enables at setup; blanket disable
   means the seat gets no strategic brain even when player type is AI.
3. Modules the sim doesn't have yet (road build, house upgrade) still round-trip through the IR so
   the data is ready when they exist.

## Verify

- `npm run test:pipeline` (schema/extraction change) and `npm run test:content` with local content.
- Headless: a map with `HAI_Disable` for an AI-type player produces zero strategic AI commands.
- `npm test`, `npm run check`, `npm run build`.
