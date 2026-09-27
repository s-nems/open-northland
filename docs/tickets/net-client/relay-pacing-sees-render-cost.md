# Let a relayed room's pacing see a client whose main thread cannot keep up

**Area:** net-client, app · **Focus:** relay pacing, session/worker · **Priority:** P3

In a relayed session the relay governs the room by each member's acknowledged tick and its reported
`load.tickMs` (`docs/NETWORK.md`, "Waiting"). Both come from the worker: `RelayClient.advance` acks
each tick as the sim steps it, and `tickCost` spans the admission and the step only, not the delta
take and post that `onTick` does after it. The relayed runtime sheds undelivered ticks instead of
holding them (`relayedSessionOptions`, `undelivered: 'shed'`), since the relay runs the clock.

So a member whose main thread cannot draw at the room's speed is never `slow`: its worker keeps up,
its view skips shed ticks and drops their non-durable events (hits, sounds, projectiles), and the room
never slows for it. That breaks the owner's rule that an overloaded game slows its clock rather than
letting the view fall behind the sim. The late-game delta path alone costs the main thread about
8 ms per delivered batch at t100k (`docs/perf/heavy-load-krwawa-rzeka-12ai.md`), so a weaker client
reaches this at x3.

## Scope

- Measure first: a two-member in-memory relay session (the `test:content` relay harness) where one
  member's runtime delivers half the posted batches; record whether the relay marks it `slow` and what
  its view skips.
- Report the main thread's shortfall to the relay: ack only ticks the runtime has delivered, or add
  the runtime's undelivered ticks to the ack's load, so the existing governor slows the room to the
  slowest member's drawn rate. Keep the wire change inside `net-protocol`'s version rules.
- Count the delta take and post in `tickMs`.

## Verify

- A `net-server` governor test with a member whose drawn rate is half the requested speed: the room
  is governed to that rate within the documented thresholds and released when it recovers.
- The relay harness run above no longer sheds ticks at the governed speed.
- `npm test`, `npm run check`.
