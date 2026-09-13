# Show civilian learners in the school building panel

**Area:** app · **Priority:** P2

Civilian lessons, capacity, target qualifications and the learn command are implemented. The selected
settler panel shows lesson progress, but the school building panel has no learner roster.

## Scope

- Show the school's occupied and available capacity and its assigned learners, including reserved
  learners still walking to the school.
- Show each learner's target profession or product and current progress from authoritative snapshots.
- Allow selecting a learner from the roster; keep ownership rules and English/Polish localization.
- Refresh after completion, cancellation, capture or destruction without stale entries.

Timing, costs and original interruption behavior belong to
[progression calibration](technology-professions-experience.md), not a second school implementation.

## Verify

Extend the school scene with multiple learners and different targets. Check selection, capacity,
completion and save/load presentation. Run normal gates and review the building panel visually.
