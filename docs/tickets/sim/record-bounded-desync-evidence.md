# Record bounded hierarchical desync evidence

**Area:** sim, app · **Focus:** inspect, diag · **Priority:** P3

`HashTrace` retains a capped list of global 32-bit FNV-1a hashes. It can identify a mismatching tick when
two traces overlap, but a single tester bundle cannot say whether RNG, fog, ownership, economy, or another
component domain diverged. Once the list reaches capacity it also shifts the backing array on every
record. The current hash remains useful as a behavior golden; replacing it would create noisy golden
changes without improving the diagnostic path.

## Scope

- Keep `Simulation.hashState()` and existing goldens unchanged. Add an opt-in, versioned 64- or 128-bit
  diagnostic digest using a named published algorithm, with RNG state and draw count, fog digest, and
  deterministic per-component or per-domain digests.
- Store diagnostic samples in a true fixed-capacity ring with O(1) append and deterministic oldest-first
  serialization. Retain the existing debug cadence and bounded snapshot policy.
- Include the detailed samples in diagnostics bundles only when `debug=diag` is active. On replay,
  compare the recorded and reconstructed digest at the first mismatching sample and report the differing
  domains without dumping full state by default.
- Keep hashing pure and outside the normal sim tick. Hash component values through the same canonical
  value encoder as the global hash so the two paths cannot disagree about supported shapes.

## Verify

- Perturb RNG, fog, and one component domain in separate fixtures; each keeps unrelated domain digests
  stable and identifies the changed domain.
- Ring wrap preserves capacity, ascending serialized order, and first-divergence lookup.
- A normal run with diagnostics disabled performs no detailed digest work and preserves all goldens.
- `npm test`, `npm run check`, and `npm run build`.
