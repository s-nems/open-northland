# Capture the disputed tick on both sides of a divergence

**Area:** net-client, app, sim, tooling · **Focus:** sync-ledger, hashtrace, diag bundle · **Priority:** P3

The relay's sync ledger names the tick and the sync domains on which a member diverged, from the
per-domain digests `Simulation.setSyncDigest` produces on every tick, and the member is rebuilt from
a donor snapshot. That per-tick stamp is what makes a disputed tick nameable at all; a windowed
digest would blur the dispute to a window and weaken both this capture and the per-tick
acknowledgement the load telemetry rides on. Nothing is kept from the moment of divergence: the diag bundle holds the command log and
the global hashes, `HashTrace` can retain recent snapshots but shifts its backing array on every
record once full, and no path captures the disputed tick on the reference client and the diverged
client for comparison. A divergence in a mass battle therefore has to be reproduced from the log,
which on a long session is the cost `docs/tickets/tooling/checkpointed-diagnostics-replay.md`
describes.

## Scope

- `HashTrace` becomes a fixed-capacity ring with O(1) append and oldest-first serialization; the
  bounded snapshot window stays.
- On an out-of-sync verdict, the diverged member and the reference member both retain the disputed
  tick's per-domain digest inputs and the snapshot window around it, and attach them to a diag bundle
  the player can download or the relay can request.
- A diff of two such bundles at the tick names the first entity and component that differ. It lands
  in the replay CLI of `docs/tickets/tooling/bundle-replay-cli.md` if that ticket is done first, or as
  its own command otherwise; either way one tool, not two.
- Hashing stays pure and outside the normal tick; a run without diagnostics performs no extra digest
  work and keeps every golden.

## Verify

- A forced divergence in the headless multi-client harness produces two bundles whose diff names the
  injected difference and its domain.
- Ring wrap preserves capacity and ascending order.
- `npm test`, `npm run check`, `npm run build`.
