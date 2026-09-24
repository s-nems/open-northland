# Pace the room by its slowest member instead of holding the clock for it

**Area:** net-server, net-client, net-protocol, app · **Focus:** relay/game, room-clock, HUD · **Priority:** P2
**Blocked by:** [07 Client load telemetry](07-client-load-telemetry.md)

A member whose acknowledged tick trails the clock by more than `WAIT_BEHIND_MS` is `lagging`, and the
relay holds the clock for everyone until it catches up. On a heavy map one weak machine turns the
room into stop-and-go for every player, and nobody sees who causes it. The decided policy is three
tiers: a free band in which the slow member catches up on its own, a governed band in which the room
slows to what that member sustains and names it, and the existing kick vote.

## Scope

- Free band: a member behind by up to a named allowance (five seconds of ticks at the room speed) is
  not waited for. Its pacer drains the backlog as it does after a resync.
- Governed band: past the allowance the relay lowers the room's effective speed to the slowest
  member's sustainable speed derived from the telemetry of 07, until that member is back inside the
  band, then restores the requested speed. The `clock` broadcast gains the limiting member's nick
  while the governor holds; bump `PROTOCOL_VERSION`.
- Every client's HUD shows who limits the room while it is governed; the limiting client sees that
  the others are waiting on it.
- The kick countdown starts when a member enters the governed band and runs as today.
- `lagging` no longer holds the clock. `gone`, `silent`, `loading` and `resync` keep their waits.
- `docs/NETWORK.md` "Waiting" and "The clock and tick frames" rewritten to the new rule.

## Verify

- Relay unit tests on the virtual clock: a member inside the band is never waited for; one past it
  lowers the speed to its sustainable value and the speed recovers when it catches up; the countdown
  and vote behave as before.
- The multi-client run of 00 with one slowed client: the other clients' frame cadence never stops,
  the room speed drops to the slowed client's value and recovers.
- Browser check on two clients through the local relay: the HUD names the limiter on both sides.
- `npm test`, `npm run check`, `npm run build`.
