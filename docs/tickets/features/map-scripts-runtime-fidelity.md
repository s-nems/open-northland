# Verify mission timing and tribute notification fidelity

**Area:** sim, app · **Priority:** P2

Mission execution and tributes are implemented, but several runtime semantics in MISSIONS.md
remain readings or approximations rather than observations of the owned executable.

## Scope

- Observe the evaluation cadence (currently three seconds), activation-relative `TimeGone`,
  `RandomTimeGone` bounds and whether loading evaluates missions immediately.
- Record reproducible observations before changing timing or introducing a load evaluation pass.
- Observe tribute creation, updates, payment and clearing notifications. Implement any confirmed
  missing cue through the existing presentation path, without duplicating messages.
- Update MISSIONS.md and retain explicit uncertainty where observations are inconclusive.

## Verify

For confirmed changes, cover boundary ticks, deterministic random behavior, save/load and tribute
notification duplication. Review changed presentation and run relevant normal gates. Full-map playthrough
is handled separately by the user and is not a deliverable of this ticket. Campaign archives are excluded.
