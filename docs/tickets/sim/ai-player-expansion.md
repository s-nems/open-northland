# Let the AI player expand past its home ring when placement stalls

**Area:** sim · **Origin:** enemy-AI design close-out 2026-07-17; narrowed after the strategic
modules landed (workforce / build order / signpost coverage / population) · **Priority:** P2

The signpost-coverage half of the original HomeExpansion idea is DONE: the GuideBuild module keeps
every owned building inside a post's nav circle (`systems/ai-player/signpost-coverage.ts`). What
remains is the pressure-triggered half (genre lesson from Petra: expansion triggers on game-state
conditions, not timers):

1. The build-order executor stalls silently when no legal spot exists within
   `BUILD_SEARCH_MAX_RADIUS_NODES` of the HQ (`systems/ai-player/build-order.ts` — the
   `spot === null` branch). Detect that pressure and resolve it with the player's own tool:
   `placeSignpost` toward open buildable ground (or a needed deposit outside the current area), then
   let the executor place near the new post — which needs the placement anchor to generalize from
   "the HQ" to "the HQ or a frontier post".
2. Condition thresholds stay named constants; candidate search bounded around the current
   building/post ring, never the whole map.

## Verify

- Headless scenario: a seat whose HQ neighbourhood is deliberately walled in (water/resources)
  places a signpost toward open ground and subsequently completes the blocked build; same seed
  twice → identical hashes.
- `npm test`, `npm run check`, `npm run build`.
