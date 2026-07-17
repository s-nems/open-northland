# Keep the AI player's economy staffed: demand-driven job and worker assignment

**Area:** sim · **Origin:** enemy-AI design close-out 2026-07-17 · **Priority:** P2
**Blocked by:** docs/tickets/sim/ai-player-scaffold.md

The CollectResources side of the HAI-style AI player (pinned by the original's
`HAI_DisableCollectResources` toggle; internals a named genre-convention approximation). Genre
consensus (Widelands ware preciousness, KaM ware-flow prediction, Petra priority queues): "what to
work on next" is a demand computation — measure shortfall per good, walk the content production
graph to the job/building that fixes the most pressing one — not a script. The graph already lives
in the content IR (goods/jobs/buildings), so this consumes data, adding no hardcoded chains.

## Scope

1. On the scaffold's decision cadence, compute per-good shortfall for the AI seat (stocks vs what
   its buildings and settlers consume) and derive job targets from the content production graph.
2. Issue the same commands the human uses: `setJob` idle settlers toward shortfall jobs,
   `assignWorker` to understaffed buildings, `setGatherGood`/`setWorkFlag` where relevant. Settler
   micro (walking, carrying, needs) stays with the existing `agents/ai.ts` planner — this module
   only sets assignments.
3. Keep per-decision cost bounded by the seat's own entities and building count, never map- or
   population-squared.

## Verify

- Headless scenario: an AI seat with a built economy keeps production running unattended (goods
  accumulate, starved buildings get workers); same seed twice → identical hashes.
- `npm test`, `npm run check`, `npm run build`.
