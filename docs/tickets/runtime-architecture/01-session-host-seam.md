# Put one host interface between the runtime and the simulation

**Area:** app, lockstep · **Focus:** view/runtime · **Priority:** P2

Twenty-four modules outside entries, scenes and sandbox setup import the live `Simulation`: the
frame loop (`fogView`, `constructionPlots`), placement gates and overlays (`placementProbe`,
`signpostProbe`, their blocker versions), diplomacy rows and the game view (`diplomacyStance`,
`hasMetPlayer`, `equipPickList`), assistant grants and counters, debug mounts (`needsEnabled`, fog
mode), diagnostics (`hashState`, `commands.log`, `setInstrument`), save export, missions and
tributes views. As long as these calls exist the sim cannot leave the thread, and every new feature
adds another one.

## Scope

- Define one host interface the runtime consumes, grouped by cadence:
  - per frame, synchronous: the current snapshot, the fog view keyed by its `generation`, construction
    plots, placement and signpost probes with their blocker versions, diplomacy stance and met state,
    assistant counters, rule flags;
  - per tick: the events of every stepped tick in order, the state hash for the diag trace;
  - rare, request-shaped: equip pick list, job choice checks, tributes, trade offers, mission status,
    briefing pages and presentation, info lines, papers, landscape edits, unlock status, match outcome,
    save export, the diagnostics bundle, the system instrument fan-out of `installSessionInstruments`.
- Land an inline implementation over the live `Simulation` first. Callers keep their current
  behaviour; only the object they hold changes.
- Type the boundary: `startFrameLoop`, unit controls, the minimap, projections, the diag bundle and the
  save controller receive the host interface, and the host interface is the only sim-facing type the
  runtime modules import. `Simulation` is constructed and typed only in entries, scenes, sandbox setup,
  the world builders under `game/world/` and the inline host; those are hosts, not runtime.

## Verify

- No runtime module outside the hosts named above imports `Simulation`.
- Scene hashes, goldens and a headless scenario run are byte-identical before and after.
- `npm test`, `npm run check`, `npm run build`.
