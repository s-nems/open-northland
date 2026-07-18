# Cut the AI player's whole-map resource scans to the spatial index

**Area:** sim · **Origin:** profiling `magiczny_las` + 6 AI seats 2026-07-18 · **Priority:** P2

Profiled headless (the `ai-map-scenario.test.ts` setup run 2400 ticks with `sim.setInstrument`, 6
AI seats, real content: ~17k spawned resource nodes, ending at 175 settlers / 46 buildings): the
`aiPlayer` system averaged 5–11 ms/tick, and per-module wrapping attributed 18.2 s of it to
`collectResources` (avg ~30 ms per seat decision, worst 674 ms) and 7.3 s to `houseBuild` (worst
753 ms, the first-decision placement searches). Steady state (final world) is fine — 0.4–2.8 ms per
decision; the cost is mid-run, when collector patches run dry and flags move.

Cause: `nearestLiveResource` (`systems/ai-player/shared.ts`) and `anyLiveResource`
(`ai-player/build-order/progress.ts`) walk `canonicalResources(world)` linearly — ~17k entities per
call on this map — and a workforce decision calls them per wanted good (4 with iron), plus the
placement affinity anchors. The sim already owns the right lever: the resource spatial index
(`resourcesNearNode`, `NodeBuckets.nearest` — the AGENTS scaling rule says nearest-X uses it, not
another scan).

Scope: reroute both helpers through an expanding ring over the resource index, preserving the
canonical `(Manhattan distance, entity id)` winner byte-for-byte (goldens must not move — same
winner, cheaper search); keep a bounded fallback for the empty-map case. Re-profile to confirm the
`collectResources` total drops an order of magnitude.

## Verify

- Existing ai-player module tests pin the winners; goldens unmoved; a repeat of the profiling run
  shows `collectResources` well under 5 ms per decision mid-run; `npm test`, `npm run check`,
  `npm run build`.
