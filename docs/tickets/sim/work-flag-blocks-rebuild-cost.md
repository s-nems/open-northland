# Make the work-flag blocker set incremental instead of rebuild-on-bump

**Area:** sim · **Origin:** profiling `magiczny_las` + 6 AI seats 2026-07-18 · **Priority:** P2

Profiled headless (the `ai-map-scenario.test.ts` setup run 2400 ticks with `sim.setInstrument`):
the `command` system cost 25 s total while applying only 411 commands — the AI's opening burst
(80 `placeSignpost`, the `setWorkFlag`/`setJob` wave) produced single ticks of 0.6–2.4 s, and a
~10 ms/tick drain persisted after.

Cause: `workFlagPlacementBlocks` (`systems/footprint/placement/work-flag.ts`) memoizes the blocked
set keyed on `workFlagBlockerVersion`, and every key bump — any resource depletion/removal, any
building or flag plant — throws the whole set away and re-walks every blocker store
(`eachBlockerCell` over ~17k resources plus buildings). Its own doc comment names the burst case: a
wave that plants flags/signposts rebuilds once per plant, because each add must be visible to the
next gate check. The command gates (`canPlaceWorkFlag`, signpost placement) sit on this, so the
burst is quadratic: N plants × O(all blockers).

Scope: maintain the blocked set incrementally — the journal-replayed `spatial-memo.ts` scaffold is
the established pattern (register in `World.verifyCaches()`; the existing `verifyBlocksMemo`
tripwire already re-derives for coherence). A plant then adds its own cells, a depletion removes
its cells, and the burst becomes N × O(own footprint). Keep the derived set byte-identical to the
full rebuild (the verifier proves it).

## Verify

- `cachesCoherent` invariant + the registered verifier pass under the fuzz suite; goldens unmoved;
  a repeat profiling run shows no multi-second `command` ticks at AI start; `npm test`,
  `npm run check`, `npm run build`.
