# Choose when an attack order interrupts the issuer's current swing

**Area:** sim · **Priority:** P3
**Needs user:** choose whether direct attack orders wait for the current non-interruptible swing.

`attackUnit` cancels `CurrentAtomic` immediately. Other direct orders defer until a non-interruptible
atomic completes. Applying that rule to combat changes unit responsiveness and melee cadence, so the
shared command rule does not settle the player-facing behavior.

## Scope

- Pin whether a direct attack order waits for the issuer's current swing or interrupts it.
- Implement that choice through the existing deferred-order mechanism when deferral is required.
- Keep target death and invalid-target cancellation deterministic.

## Verify

- Melee order tests pin a retarget during wind-up, on the hit frame, and after target death.
- The battle scene confirms that repeated retargeting follows the chosen rule.
- `npm test`, `npm run check`, and `npm run build`.
