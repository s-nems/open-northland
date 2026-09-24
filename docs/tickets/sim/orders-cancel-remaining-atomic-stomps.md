# Decide and apply which orders wait for a non-interruptible atomic

**Area:** sim · **Focus:** `systems/orders` · **Priority:** P3
**Needs user:** agree, order by order, which orders wait for the current atomic and which cut it off.

`moveUnit`, `attackMoveUnit`, `setJob`, `placeSignpost` and `openChest` park behind a non-interruptible
atomic (`deferOrderDuringAtomic` + `DeferredOrder` + `deferredOrderSystem`): a settler mid-meal or
mid-swing finishes it, and the order applies the tick it ends. Every other order that takes the settler
removes `CurrentAtomic` outright, so the same meal or swing is cut off halfway:

- employment: `assignWorker`, `unassignWorker`, `assignBuilder` and `unassignBuilder`, all through
  `cancelActionAndRoute` (`systems/orders/work/employment.ts`);
- equipment: `equipGood` and `unequipGood`, through `stampEquipOrder` (`systems/orders/equipment.ts`);
- needs: `orderNeed` (`systems/orders/needs.ts`);
- drill and school: `trainSoldier` and `learn` through `startDrill`, and `cancelTraining`
  (`systems/orders/training.ts`, `systems/orders/education.ts`); the assistant's drill booking shares
  `startDrill`;
- `setGatherGood` (`systems/orders/work/selection.ts`) cuts a harvest swing on a gather-good change.

The rule is not settled. Waiting keeps meals and swings whole; cutting off answers the player at once,
which may matter more for some orders (an ordered meal, a drill, a queued equip errand). The original's
behavior for these orders mid-atomic is unobserved. Talk the list through with the owner before
implementing. Attack orders have their own decision in
[attack-order-atomic-interruption](attack-order-atomic-interruption.md).

## Scope

- Record the agreed rule for each order above.
- Add each order that should wait to `DeferrableOrderCommand` and the `applyDeferredOrder` dispatch,
  with a `deferOrderDuringAtomic` gate after its own refusals. A parked order is dropped by the next
  order that takes the settler (`supersedeStandingOrders`).
- If `setGatherGood` should keep the swing, release the gatherer at the swing boundary (the pattern of
  the `DeferredOrder` chain break in `atomicSystem`) without postponing the selection itself.
- Leave `attackUnit` to its own ticket.

## Verify

- One case per changed order in `packages/sim/test/settlers/deferred-orders.test.ts`: mid-meal, the
  order parks, the meal completes, the order applies that tick; an order that stays immediate keeps a
  case pinning the cut.
- Goldens unchanged unless a golden scenario issues a changed order mid-atomic; name that in the commit.
- `npm test`, `npm run check`, `npm run build`.
