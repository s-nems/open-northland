# Persist and restore simulation state

**Area:** sim, data · **Priority:** P1
**Blocked by:** [Authorized command envelopes](../sim/player-command-authority.md)

The project has deterministic replay for diagnostics, but no persisted save format or load API.
Replaying `{content, seed, map, commandLog}` can rebuild a short session and prove determinism. It is
not a practical save system for a game that can run for hours.

The runtime `WorldSnapshot` is also not a save file. It is a presentation view and omits restorable
simulation resources and loader metadata. A save needs a versioned, validated state format that can
resume at the same tick without replaying the whole session.

## Scope

1. Define a versioned `SaveGame` schema with stable section/component identifiers, content revision and
   map fingerprint, tick, seed, and every mutable resource needed to resume exactly. This includes entity
   ids and allocation state, components, RNG state and draw count, fog, world rules, pending command
   envelopes, and scheduled state that can survive a tick boundary.
2. Add explicit export and restore APIs. Loading is a trusted initialization path before ticking; it
   must restore entity allocation and component ownership without exposing a general live-world
   mutation API.
3. Keep replay history out of the core save payload. A diagnostic artifact may wrap a save checkpoint
   with a bounded command tail, but loading a save must not replay the session from tick zero.
4. Establish the migration seam with a committed v1 fixture and a registry keyed by schema version.
   Reject unknown future versions; every later schema change must add a fixture and explicit migration
   before advancing the current version.
5. Reject corrupt files, content/map mismatches, duplicate or unknown component sections, and invalid
   pending envelopes with path-specific errors.
6. Document the persisted format separately from the presentation `WorldSnapshot` in
   `docs/DATA-FORMAT.md`. Do not expose or serialize render caches.

## Verify

- Run a scenario to tick M, save and restore it, then advance both copies with identical commands to
  M+N; hashes and events match the uninterrupted run.
- Cover RNG continuation and draw count, fog state, next entity id, pending commands, empty and populated
  worlds, the committed v1 fixture, and rejected schema/content/map versions.
- Serializing the same state twice produces byte-identical output.
- `npm test`, `npm run check`, and `npm run build`.
