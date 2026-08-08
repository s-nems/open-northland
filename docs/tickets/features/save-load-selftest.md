# Add save round-trip self-checks to the determinism harness

**Area:** sim · **Focus:** test harness · **Priority:** P2
**Blocked by:** [SaveGame restore](save-load-sim-restore.md)

A field missed by export surfaces as a hash divergence far from the commit that introduced the new
state. 0 A.D. closes this gap with a serialization test mode that round-trips state every turn;
Factorio's heavy mode does the same with per-tick CRCs. The fuzz determinism suite
(`packages/sim/test/core/fuzz-determinism.test.ts`) already replays and compares checkpoints and is
the natural host.

## Scope

Every K ticks during the fuzz run: export, restore, compare `hashState` between the live and
restored sim, and assert the restored sim re-exports byte-identically. Choose K so the suite stays
within its current runtime budget, and measure that claim. New mutable sim state that misses export
must fail this suite in the commit that adds the state.

## Verify

- Fuzz suite passes within the current runtime budget; during development, a deliberate local
  omission of one section demonstrably fails the check.
- `npm test`, `npm run check`, `npm run build`.
