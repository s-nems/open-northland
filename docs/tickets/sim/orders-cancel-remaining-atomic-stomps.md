# Extend the non-interruptible-atomic gate to the remaining order handlers

**Area:** sim · **Priority:** P3

`moveUnit`, `setJob`, and `placeSignpost` now park behind a non-interruptible atomic
(`deferOrderDuringAtomic` + `DeferredOrder` + `deferredOrderSystem`). Verified remaining sites that
still cancel a `CurrentAtomic` unconditionally, losing a mid-flight swing:

- `attackUnit` (`systems/orders/combat.ts`) - deliberately left out: deferral changes combat feel and
  the melee test suites; decide whether an attack order should wait out the issuer's own swing.
- `assignWorker` (`systems/orders/work/employment.ts`, via `reidleAsJob`) and `assignBuilder` - the
  employment twins of the gated `setJob`; the mechanism extends by adding their kinds to
  `DeferrableOrderCommand` plus a gate call and a dispatch case.
- `setGatherGood` (`systems/orders/work/selection.ts`) cancels a harvest-effect atomic mid-swing on a
  gather-good change; a swing-boundary release (the `DeferredOrder` chain-break in `atomicSystem` is
  the pattern) would preserve the swing without deferring the selection itself.

## Verify

- One headless case per newly gated handler: a settler mid-uninterruptible atomic keeps it; the order
  applies at completion. Watch the melee move-order suites for `attackUnit`.
