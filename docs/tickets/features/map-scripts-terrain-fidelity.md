# Verify scripted terrain edits against the original

**Area:** sim, app, render, pipeline · **Priority:** P2

Terrain script handlers work, but MISSIONS.md records approximations for FX classification,
vertex tint projection and landscape placement arguments.

## Scope

- Confirm each FX-removal family against owned landscape names and observed original removals.
- Compare vertex palette multiplication and land-only filtering with the original; establish whether
  the current cell/node projection is sufficient or needs a more faithful rendering seam.
- Establish the `SetLandscape` size and final-flag behavior and implement confirmed missing effects.
- Keep rendering, collision and saved edits consistent. Preserve explicit approximations until verified.
- Update MISSIONS.md. Chest payload, opening and every reward are implemented.

## Verify

Use reproducible original observations, synthetic family/boundary cases, collision checks and save/load.
Review the terrain scene after visual changes. Run normal gates and pipeline/content checks for extraction
changes. Do not commit original assets or reference captures.
