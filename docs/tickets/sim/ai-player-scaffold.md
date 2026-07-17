# Add the strategic AI-player scaffold: seat flag, decision cadence, module seam

**Area:** sim · **Origin:** enemy-AI design close-out 2026-07-17 · **Priority:** P2

Design decisions (closing docs/tickets/features/enemy-ai-opponent.md, deleted with this ticket's
filing commit):

- **Direction: reimplement the original's autonomous HAI, not its scripted mission layer.** The
  original engine has a built-in autonomous AI for `PLAYER_TYPE_AI = 2` players
  (`Data/GameSourceIncludes/logicdefines.inc:358`), decomposed into per-module map-data toggles
  (`Game.exe` strings): `HAI_DisableCollectResources`, `HAI_DisableGuideBuild`,
  `HAI_DisableHomeExpansion`, `HAI_DisableHouseBuild`, `HAI_DisableHouseUpgrade`,
  `HAI_DisableMilitary`, `HAI_DisableRoadBuild`, plus blanket `HAI_Disable`. Scenario maps mostly
  disable HAI and choreograph the scripted `AI_MainTask_*`/`AI_SetCondition_*` layer instead
  (`CnModMaps/cn_2/ai.inc`); free-play maps ship an empty `[AIData]`, i.e. full HAI. The scripted
  layer is out of scope for this ticket family. Goal: an AI seat plays like a normal player
  (economy, build order, expansion) so games can run themselves for observation and testing.
- **Named approximation:** the module *list* is pinned by the toggle vocabulary; the behavior
  *inside* each module is genre convention (Widelands DefaultAI, KaM Remake advanced AI, 0 A.D.
  Petra: demand-driven build choice, authored bootstrap, condition-triggered expansion, coarse
  staggered re-evaluation) — no byte-level evidence of the original's internals exists.
- **Seat:** an AI player is a per-player sim brain issuing the same `Command` union the human does,
  through the existing queue (`core/command-queue.ts` — already documented as the AI's seam). Pure
  function of world state + seeded RNG; no app-side per-tick reads.

## Scope

1. A sim-side "this player is AI-driven" flag settable at setup (extend `RulesCommand` or setup
   data — whichever keeps the save/replay log complete), plus a small per-AI-player state store.
2. An `aiPlayer` strategic system in `SYSTEM_ORDER` (`systems/schedule.ts`) — distinct from the
   settler micro-planner `agents/ai.ts`; name it to avoid the collision. It runs each AI player's
   *modules* on a coarse decision cadence (named tick-interval constant, staggered per player so
   cost scales with decisions, not ticks) and enqueues resulting commands.
3. The module interface (e.g. `(world, playerId, rng) => Command[]`) with per-module enable flags
   mirroring the HAI toggle decomposition; ship with modules empty — build/workforce/expansion/
   military land as follow-up tickets (`ai-player-build-order.md`, `ai-player-workforce.md`,
   `ai-player-expansion.md`, `ai-player-military.md`).
4. Any new command variant joins the fuzz generator (`test/core/fuzz-determinism.test.ts`).

## Verify

- Headless: same seed + an AI-flagged player twice → byte-identical state hashes; a non-flagged
  player gets zero AI commands.
- `npm test`, `npm run check`, `npm run build` (sim hygiene test covers purity).
