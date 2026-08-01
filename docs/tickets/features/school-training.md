# Teach civilian trades in the school

**Area:** sim, app · **Priority:** P2
**Blocked by:** [school-size extraction](../pipeline/building-school-size.md)

The sim trains recruits at a barracks but does not implement the school's LEARN path. Readable rows
allow up to five learners to train toward civilian jobs and goods mastered by another tribe member.
Several targets use their job experience bucket rather than the general TRAINING bucket.

The TRAINING bucket is cleared when the learner changes target. It must not accrue permanently and
pre-pay later lessons.

## Scope

- Assign a learner and mastered target to a school with available capacity.
- Resolve each target's authored experience type and threshold.
- Clear target-specific progress when the target changes and apply the trade or good unlock on completion.
- Show learners and their current targets in the school details panel.

## Verify

- Headless cases cover capacity, target changes, both experience-bucket shapes, and completion.
- A registered school scene exposes the learner and target in the panel.
- `npm test`, `npm run check`, and `npm run build`.
