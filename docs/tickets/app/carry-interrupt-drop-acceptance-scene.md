# Acceptance scene for carry-interrupt drop

**Area:** app (acceptance scene) · **Origin:** carry-interrupt-drop feature, 2026-07-16 · **Priority:** P3
**Needs user:** the scene's point is a human pixel/behavior sign-off (drop animation + drop-then-flee feel).

The carry-interrupt-drop mechanic landed in `feat/carry-interrupt-drop`: a settler whose carrying is
interrupted stops, sets its load down first (the `drop` atomic, id reuses the pickup gesture — see
`packages/sim/src/systems/agents/actions.ts` `DROP_ATOMIC_ID` / `startDrop`, which clears the nav state so
the drop is a standstill), and only then does the interrupting thing. The drop is stacking-aware (own
tile, spilling over `MAX_GROUND_STACK` to the nearest free hexes — `dropCarriedLoad` in
`.../effects-goods/carry.ts`). The three interrupt triggers are a **player move order** (drop where it
stands, then walk to the ordered spot empty-handed — parked on `PlayerOrder.pendingGoal`, launched by
`playerOrderSystem`), a **profession/employment change** (`setJob`/`assignWorker`), and an **enemy** (the
FLEE drive). A builder re-pinned to another site (`assignBuilder`) deliberately KEEPS its load — re-pinning
is the same trade, so it hauls the material onward rather than dumping it. The mechanic is proven headlessly
in `packages/sim/test/agents/carry-interrupt-drop.test.ts`, but there is **no acceptance scene** for a
human to sign off the pixels — the drop animation and the drop-then-flee sequence.

Per `packages/app/AGENTS.md`, a player-visible mechanic wants a `SceneDefinition` so the browser and the
headless test observe the same deterministic run. This was deferred to keep the feature branch scoped.

## Scope

- Add `packages/app/src/scenes/carry-interrupt.ts` (register in `scenes/index.ts`; localized title +
  summary in both catalogs) staging the interrupts a human can watch:
  1. A settler carrying a load, then an **enemy raider** approaching → it stops, drops the load (bend
     animation) and flees. Note: a civilian only flees when it is a combatant (carries `Health`) with
     `Stance` FLEE — check how `spawnSandboxSettler` / the battle scene give units `Health`, and stage the
     carrier so the flee path fires (the sim flee test uses `combatant(...)` with an explicit FLEE stance).
  2. A settler carrying a load whose **profession is changed**, or that is **move-ordered** → it stops,
     drops (bend animation), a ground heap appears, then it re-employs / walks off empty-handed. (A player
     action in the browser; the headless `checks` assert the drop + the ground heap.)
- Staging a `Carrying` load pre-tick-0 needs a direct entity handle (the `spawnSettler` command resolves
  during `step`, so `build(sim)` can't add `Carrying` to a command-spawned unit). Use the
  `spawnIdleSettler`-style direct `systems.createSettler` path (see `game/sandbox/place/`) and add
  `Carrying` to the returned entity.
- Headless `checks`: after `runTicks`, the carrier no longer carries, a loose ground heap of the good
  exists (goods conserved — `yardGood`/`countGroundPiles` in `scenes/sandbox-queries.ts`), and (for the
  enemy case) the carrier is `Fleeing` / has moved away.

## Verify

- `npm test` (the auto-added headless scene test is green).
- `npm run dev` → `?scene=carry-interrupt`: watch the settler come to a stop and play the drop gesture
  before the flee / re-employ / walk-off, and the ground heap appear. Confirm a move-ordered carrier drops
  where it stands (a ground heap appears) then walks off empty-handed, rather than hauling the load to the
  destination. Judge the drop-then-flee timing: the drop reuses the pickup animation length (~20 ticks), so
  a threatened carrier stands a beat before it runs — confirm this reads fair and doesn't get it killed
  unfairly (if not, consider an instant drop or flee-first for the enemy case). Ask the user to sign off.
