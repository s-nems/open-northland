# Report each client's tick cost and backlog to the relay

**Area:** net-protocol, net-client, net-server · **Focus:** ack, room view · **Priority:** P2
**Blocked by:** [00 Heavy-load reference](00-heavy-load-reference.md)

The relay knows a member only by its acknowledged tick. It cannot tell a member that is slow to
compute from one whose link is slow, and it cannot derive the speed a member could sustain. The pace
governor of 08 needs both.

## Scope

- The `ack` message (`{ tick, digest, world }` in `packages/net-protocol/src/messages.ts`, sent per
  tick) gains the client's smoothed per-tick cost in milliseconds and the frames it holds buffered.
  Bump `PROTOCOL_VERSION`; the parser refuses the old shape.
- The relay keeps per-member load beside its input-delay estimate and exposes it in the room view
  and in the lobby's member list.
- `docs/NETWORK.md` documents the fields and their smoothing.

## Verify

- Relay unit tests: a member's reported cost and backlog are stored, smoothed and exposed.
- The headless client under test reports the figures; the multi-client run of 00 shows the slowed
  client's cost.
- `npm test`, `npm run check`, `npm run build`.
