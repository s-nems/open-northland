# Calibrate the signpost visuals against the running original

**Area:** app/render (signposts) · **Origin:** signposts feature branch, 2026-07-16 · **Priority:** P3
**Needs user:** visual comparison with the running original — not autonomously runnable.

Three signpost visuals shipped as named approximations that only a human with the running original
can pin down:

- **Board frame ↔ bearing join** — `packages/render/src/data/scene/signpost-boards.ts` assumes
  decoded `ls_guidepost.bmd` bob 1 points screen-north and bobs 1..18 sweep clockwise in 20° steps
  (inferred from the frames' pivot offsets). Verify a board genuinely points at its neighbour in
  all directions; fix the bucket formula (offset/direction/mirroring) if not.
- **Palette** — the pipeline's hand-authored binding decodes `ls_guidepost.bmd` with `bridge01`
  (no palette alias names the guidepost; the engine's own choice is unrecovered —
  `tools/asset-pipeline/src/stages/bmd/bindings.ts`). Compare wood tones with the original.
- **Erect-button glyph** — the scout menu's button uses the `order_scout` eye-with-rays frame
  (provisional; `packages/app/src/hud/action-ring-menu.ts`). Identify the original's actual
  "Erect Signpost" icon frame in the `ls_gui_window` sheet (overlaps the
  `gui-atlas-confirmation.md` session).

Also worth checking there: the sim radii approximations (`SIGNPOST_NAV_RADIUS_NODES` 40 /
`SIGNPOST_SPACING_RADIUS_NODES` 16 / `LOCAL_NAV_RADIUS_NODES` 24, `packages/sim/src/components/signpost.ts`)
against the original's observed circles — the values live only in the original executables.

## Verify

`?scene=signposts` boards point at their neighbours; palette and icon match the original by eye;
radii re-stamped with an observed basis note.
