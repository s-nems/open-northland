# Surface tech-locks in the HUD (building menu + Upgrade button)

**Area:** features (app/hud) · **Origin:** building-upgrades branch, 2026-07-17 · **Priority:** P2

The sim's `jobEnables` tech gate (`buildingEnabled`, packages/sim/src/systems/progression/unlocks.ts)
silently skips a gated `placeBuilding`/`upgradeBuilding` command, but the HUD renders the controls as
active: the tool-panel building menu offers every building, and the details panel's Upgrade button
draws enabled even when the target tier is tech-locked (real viking content gates the home tiers on a
collector/mason/farmer being alive — `jobEnablesHouse 8/12/18`). The result is a dead click with no
feedback.

Make both surfaces tech-aware: compute the same enablement the sim checks (tribe's `jobEnables` edges
× the snapshot's living settlers' jobs — a pure snapshot+content projection, no live-store reads) and
draw locked entries greyed with a tooltip naming the enabling trade. Keep the sim-side guard as the
authority; the HUD read is presentation only. Verify with a scene that has no collector: the home's
Upgrade button and the gated menu entries must render locked, and gain color once a collector spawns.
Source basis: the gating edges are extracted `tribetypes.ini jobEnables`; the greyed-with-tooltip
presentation is the original's building-menu behavior (observe it in the running original before
polishing).
