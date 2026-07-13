# Rebind clean-room tuning and animation bindings onto real content ids

**Area:** app (`game/sandbox/` + catalog) · **Origin:** global-content plan reconciliation,
2026-07-12 · **Blocked by:** [real-content-balance-overlay](real-content-balance-overlay.md) · **Priority:** P1

The clean-room tuning tables are keyed by the sandbox's fabricated ids; once the real ContentSet
is the base (previous tickets in the chain), they must be re-pointed at the real numbering or the
merged content animates and works nothing.

## Scope

- Rebind gatherer/carrier/soldier tuning, `atomicAnimations` lengths, and tribe `atomicBindings`
  to real job ids.
- Re-key the farm haul-out routing on the field-producer signal (the `fix/farmer-carrier-logistics`
  follow-up) now that the real economy path exists.

## Verify

- Headless test: the merged economy is alive end-to-end — joinery (or its plank replacement)
  produces.
- Determinism preserved (seeded RNG only); sim-package goldens byte-identical.
