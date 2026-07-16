# Calibrate the signpost visuals against the running original

**Area:** app/render (signposts) · **Origin:** signposts feature branch, 2026-07-16 · **Priority:** P3
**Needs user:** visual comparison with the running original — not autonomously runnable.

One signpost visual shipped as a named approximation that only a human with the running original
can pin down:

- **Board frame ↔ bearing join** — `packages/render/src/data/scene/signpost-boards.ts` assumes
  decoded `ls_guidepost.bmd` bob 1 points screen-north and bobs 1..18 sweep clockwise in 20° steps
  (inferred from the frames' pivot offsets). Verify a board genuinely points at its neighbour in
  all directions; fix the bucket formula (offset/direction/mirroring) if not.

(The palette question is resolved: the guidepost is drawn through the owner's full player palette —
the board-text indices 23–30 sit inside the `playerNN.pcx` ramp — served as 16 per-player baked
atlases (`ls_guidepost.player_NN`; the indexed+LUT path shredded the graded edge alpha);
`bridge01` remains only the single-colour fallback. Still eyeball the wood tones against the
original while checking the boards.)

Also observed-original deviations to weigh while in there (named in
`packages/app/src/view/unit-controls/index.ts`): the original places a signpost with RIGHT-click on
ground that is "lit up" (tutorial_001 briefing); we place with left-click and DIM blocked ground,
matching our building-placement convention.

Also worth checking there: the sim radii approximations (`SIGNPOST_NAV_RADIUS_NODES` 40 /
`SIGNPOST_SPACING_RADIUS_NODES` 16 / `LOCAL_NAV_RADIUS_NODES` 24, `packages/sim/src/components/signpost.ts`)
against the original's observed circles — the values live only in the original executables.

## Verify

`?scene=signposts` boards point at their neighbours; wood tones match the original by eye;
radii re-stamped with an observed basis note.
