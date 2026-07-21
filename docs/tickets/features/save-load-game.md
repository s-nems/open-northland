# Persist and restore simulation state

**Area:** sim + data · **Priority:** P1

The project has deterministic replay for diagnostics, but no persisted save format or load API.
Replaying `{content, seed, map, commandLog}` can rebuild a short session and prove determinism. It is
not a practical save system for a game that can run for hours.

The runtime `WorldSnapshot` is also not a save file. It is a presentation view and omits restorable
simulation resources and loader metadata. A save needs a versioned, validated state format that can
resume at the same tick without replaying the whole session.

## Scope

1. Define a versioned `SaveGame` schema with content version/revision, map identity, tick, seed, and
   every mutable resource needed to resume exactly. This includes entity ids and components, RNG,
   fog, world rules, and any queue state that can survive a tick boundary.
2. Add explicit export and restore APIs. Loading is a trusted initialization path before ticking; it
   must restore entity allocation and component ownership without exposing a general live-world
   mutation API.
3. Decide how much command history the file retains for replay and diagnostics. The log may accompany
   the state, but it is not a substitute for restorable state.
4. Reject corrupt files, incompatible schema versions, content mismatches, and unknown component
   shapes with readable errors.
5. Document the persisted format separately from the per-frame snapshot in `docs/DATA-FORMAT.md`.

## Verify

- Run a scenario to tick M, save and restore it, then advance both copies with identical commands to
  M+N; hashes and events match the uninterrupted run.
- Cover RNG continuation, fog state, next entity id, empty and populated worlds, and rejected schema
  or content versions.
- `npm test`, `npm run check`, and `npm run build`.
