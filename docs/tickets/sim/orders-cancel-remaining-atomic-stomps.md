# Extend the non-interruptible-atomic gate to the remaining order handlers

**Area:** sim · **Priority:** P3

`moveUnit`, `setJob`, and `placeSignpost` now park behind a non-interruptible atomic
(`deferOrderDuringAtomic` + `DeferredOrder` + `deferredOrderSystem`). The remaining employment and
work-selection handlers still cancel a `CurrentAtomic` unconditionally, losing a mid-flight swing:

- `assignWorker` (`systems/orders/work/employment.ts`, via `reidleAsJob`), `unassignWorker`, and
  `assignBuilder` - the employment twins of the gated `setJob`, all three now cancelling through the
  shared `cancelActionAndRoute`; the mechanism extends by adding their kinds to
  `DeferrableOrderCommand` plus a gate call and a dispatch case.
- `setGatherGood` (`systems/orders/work/selection.ts`) cancels a harvest-effect atomic mid-swing on a
  gather-good change; a swing-boundary release (the `DeferredOrder` chain-break in `atomicSystem` is
  the pattern) would preserve the swing without deferring the selection itself.
- `trainSoldier` (`systems/orders/training.ts`) - the barracks drill order, same shape as the
  employment twins above; the AI's garrison hire already skips a mid-action man to avoid the stomp
  (`ai-player/workforce/garrison.ts`), which a gate here would make unnecessary.

Attack orders have a separate player-control decision in
[attack-order-atomic-interruption](attack-order-atomic-interruption.md).

## Scope

- Add `assignWorker`, `unassignWorker`, `assignBuilder`, and `trainSoldier` to the existing
  deferred-order path.
- Release `setGatherGood` at the current swing boundary without postponing the selection itself.
- Remove the AI garrison workaround made redundant by the command gate.
- Leave `attackUnit` unchanged.

## Verify

- One headless case per newly gated handler: a settler keeps the current atomic and the order applies
  at completion.
- Existing melee order behavior and goldens remain unchanged; run `npm test`, `npm run check`, and
  `npm run build`.
