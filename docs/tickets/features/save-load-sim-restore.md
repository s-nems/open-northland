# Restore a Simulation from a validated SaveGame

**Area:** sim · **Priority:** P1
**Blocked by:** [SaveGame export](save-load-sim-export.md)

Loading needs a trusted initialization path that rebuilds a `Simulation` at the saved tick without
replaying the session and without a general live-world mutation API. `packages/sim/AGENTS.md` pins
the shape: `new World()` and `new Simulation()` are complete resets, and external callers mutate a
running sim only through commands, so restore constructs a fresh sim before ticking.

## Scope

- `parseSaveGame` validation with at-prefixed path errors following the `parseCommandEnvelope`
  pattern (`packages/sim/src/core/commands/parse.ts`); sim stays free of a validator dependency.
  Reject with a path-specific message: unknown or future `formatVersion`, an `irVersion` mismatch,
  map fingerprint mismatch, duplicate or unknown sections, unknown component identifiers, malformed
  values, and invalid pending envelopes (reusing `parseCommandEnvelope`).
- A `contentRevision` difference is reported to the caller, never a rejection: the revision also
  bumps for presentation-only decoder fixes, so a hard reject would invalidate every save on a
  cosmetic bump. This matches the desktop shell, which classifies a revision mismatch as playable
  `stale-revision` (`packages/desktop/src/content-state.ts`).
- `restoreSimulation(save, {content, map})` builds a fresh sim: terrain rebuilt from content plus
  map; stores repopulated in saved insertion order; components registered in saved order; alive set
  and `nextId` restored verbatim; RNG `setState`; fog masks, `activeMode`, and `lastRebuildTick`
  restored with `visibleBounds` recomputed from the masks (derived state is rebuilt, never loaded);
  pending envelopes and `nextSequence` restored; tick set. A rejected file must not partially
  construct anything.
- Rules carrier components restore exactly as saved. An absent carrier is a different state from a
  carrier holding default values; restore performs no normalization.
- Derived caches need no code: they are `WeakMap`-keyed on the `World`, so a fresh world starts
  clean.
- Non-goals: migrations, UI, autosave.

## Verify

- Run a scenario to tick M, export, restore, then advance both sims with identical commands to
  M+N: `hashState()` and the event stream match the uninterrupted run every tick. Include a window
  crossing a fog rebuild cadence boundary to prove the cadence fields restore.
- RNG continuation, pending envelopes applying on schedule after restore, and `nextSequence`
  continuing without renumbering.
- Re-exporting a restored sim is byte-identical to the original save.
- Insertion-order preservation: a scenario where remove and re-add moved an entity to the end of a
  store must restore that order; an ascending-id rebuild must fail this test.
- Rejection cases: future version, wrong `irVersion`, wrong map fingerprint, duplicated section,
  unknown component id, malformed envelope; each error names the failing path. A differing
  `contentRevision` loads and surfaces the difference.
- `npm test`, `npm run check`, `npm run build`.
