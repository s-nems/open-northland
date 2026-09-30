# Stop a moving chat partner on reachable ground

**Area:** sim · **Focus:** social, movement · **Priority:** P2

A settler seeking company can stop its chosen partner between lattice nodes, then fail to reach
that partner. `planGossipSeek` (`systems/social/gossip/plan.ts`) permits an autonomous traveller
through its `grabbable` fallback. `approachPartner` (`systems/rendezvous.ts`) clears the partner's
navigation immediately and aims the seeker at the partner's truncated node. During a legal
diagonal beside a forbidden flank, that node can be unwalkable or dynamically blocked. The chat
then cancels despite accessible ground for a meeting, leaving the recruited partner off-centre.

Verified with `testContent`, seed 1 and `grassNodeMap(16,16)`: route an owned civilian from node
(4,4) to (6,8), beside water at (4,5). Advance until its interpolated position truncates to (4,5),
then let a company seeker at (10,8) recruit it. The gossip pass removes the partner's live route,
the seeker requests (4,5), and routing fails. The next gossip pass cancels both chat markers. A
second reproduction uses walkable grass with a resource footprint blocking (4,5), with the same
result. Neither reproduction emits `settlerLost`; this is an additional movement and company-need
defect. Source basis: current code and synthetic system-chain reproductions.

## Scope

- Let a recruited moving partner finish a safe stopping step before holding it for the meeting.
- Aim the seeker at a reachable stand that satisfies the existing adjacency rule, accounting for
  diagonal midpoints and dynamic blockers.
- Preserve chat interruption, partner cooldowns and genuine unreachable-pair cancellation. Check
  the shared rendezvous helper's wedding caller without changing wedding rules.

## Verify

- Extend gossip tests with both forbidden-flank cases: the partner stops on a valid centre and the
  pair reaches a talk/listen round without a failed request.
- Keep actual unreachable pairs cancelling and existing gossip and rendezvous suites passing.
- Run the standard gates in `docs/TESTING.md`.
