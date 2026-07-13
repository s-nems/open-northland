# Implement save/load: a persisted save format over the command log

**Area:** sim + app · **Origin:** gap-analysis audit 2026-07-13 · **Priority:** P1

No save/load exists anywhere. `docs/ARCHITECTURE.md` ("Save / load & multiplayer (forward-looking,
not yet built)", ~line 92) already states the direction: because the sim is deterministic and
command-driven, a save is `{ seed, contentVersion, map, commandLog }` for replay **plus a state
snapshot for fast load** (replaying hours of ticks is unviable). The in-sim pieces half-exist as
debug tooling but there is no serialize/deserialize or file format:

- `packages/sim/src/core/command-queue.ts` — `LoggedCommand` is documented as "the unit of the
  command log — the append-only record that IS the save format"; `CommandQueue.log` exposes it.
- `packages/sim/src/simulation.ts` (~lines 75, 106) — comments state "a save is the command log".
- `packages/sim/src/replay/replay.ts` — `replay(opts)` already reconstructs a `Simulation` from a
  command log (built as a divergence-debug harness, not a save format).
- `packages/sim/src/inspect/snapshot.ts` — `takeSnapshot(world, tick, events): WorldSnapshot`
  exists for diffing, but is not a validated/versioned serialization.
- No save/load UI anywhere in `packages/app`.

Tradeoff to present and pick: **command-log save** (small, exact, but load time grows with session
length) vs **snapshot serialization** (fast load, but every component store must round-trip
byte-identically). ARCHITECTURE's stated direction is *both*, log as ground truth + snapshot as an
accelerator — this ticket should implement the command-log format first (it is the invariant-bearing
one and `replay()` already consumes it) and may defer the fast-load snapshot to a follow-up ticket
it files.

## Scope

1. Design the save format: a versioned JSON (or binary) envelope carrying seed, content version/hash,
   map id, and the `LoggedCommand[]` log. Document it in `docs/DATA-FORMAT.md` or a doc the format
   already has a home in.
2. Sim-side `serializeSave(sim)` / `loadSave(save, deps)` (the latter can be a thin wrapper over the
   existing `replay()`), with schema validation on load — a corrupt or version-mismatched save fails
   loudly, not with silent divergence.
3. Determinism gate: golden rules apply (AGENTS.md rule 1-2) — save → load → continue N ticks must
   hash-match never-saved run of the same seed+commands. Use the existing `HashTrace` seam.
4. App-side save/load UI (menu buttons, browser storage/download) is a **follow-up ticket this
   ticket files** — keep this session sim-format + a minimal headless round-trip.
5. If the fast-load snapshot half is deferred, file it as a follow-up ticket with the round-trip
   requirement named.

## Verify

- Unit/integration test: run a scenario M ticks issuing commands, save, load, run to tick M+N; state
  hash equals an uninterrupted run at M+N.
- Schema-validation test: truncated/mutated save is rejected.
- `npm test`, `npm run check`, `npm run build`.
