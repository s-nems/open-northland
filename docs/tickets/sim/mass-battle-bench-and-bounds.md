# Bench mass-battle ticks before bounding the combat-scale terms

**Area:** sim, tooling · **Focus:** conflict · **Priority:** P2 · **Complexity:** medium

The target session is late game at speed x3 with large armies, but no benchmark measures a mass
battle: `bench:map` grows an economy (combat share 9-11% there, post target-index rework), and the
synthetic bench spawns fighters without staging an engagement. Which term dominates at army scale -
combat target picks, `separation`'s collider pass, `pathfinding` under mass orders, `projectile`
flight, or the conflict-adjacent scans (`animalFright`, defence) - is currently unmeasured, and
bounding the wrong one wastes the work.

## Scope

- Stage a deterministic mass battle: two or more seats, hundreds of fighters per side, ordered into
  contact on a real or synthetic map (the independent-axes work in
  [bench-world-scenery-mix](bench-world-scenery-mix.md) helps but is not a prerequisite).
- Report per-system share and growth against army size (for example 100 vs 400 vs 1000 fighters),
  through the existing bench report machinery.
- File or update bounding tickets from the measured ranking; do not optimize inside this ticket.

## Verify

- The bench runs reproducibly (`ON_BENCH_*` knobs documented) and its report names the top terms
  with shares and growth factors.
- `npm test`, `npm run check`, `npm run build`.
