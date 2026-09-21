# Trial local water reactions around moving objects

**Area:** render · **Focus:** visual polish · **Priority:** P3

The graphics-polish branch already animates water swells, shimmer and depth-dependent glints. Add a
bounded trial of local reactions tied to visible objects: a small wake behind a moving boat and subtle
ripples around fish. These are proposed artistic approximations, not claims of original-engine fidelity.
Recheck the current water work before implementation: general surface distortion, tint and shoreline
bands belong to the ongoing water polish and must not be duplicated here.

## Scope

- Start with one available boat binding and a short wake driven by its presented position, heading
  and speed. Inspect the integrated vehicle path first; do not create vehicle mechanics for this trial.
- Add a small fish-ripple comparison using the existing fish presentation. Keep frequency and
  amplitude restrained so schools do not cover the water with effects.
- Reuse existing effects where suitable. Clip reactions to water, fade them naturally when movement
  stops, and respect depth ordering around banks, hulls and other objects.
- Keep effects presentation-only, controlled by the environment-motion setting and the presentation
  clock. Do not reveal hidden entities or change simulation state, navigation or saved mechanics.
- Bound effect lifetime, count and retained history to the visible scene. Handle pause, speed changes,
  culling, entity removal and load without stale trails or long streaks after position discontinuities.
- Keep the experiment switchable for A/B review; defer reflections and a physical fluid simulation.

## Verify

- Compare on a playable map at normal zoom, ×2 and zoom-out: a moving, turning and stopped boat,
  visible fish, shallow/deep water and travel near a bank. Confirm no effect paints onto land.
- Check motion disabled, pause/resume, fog, removal, camera re-entry and save/load; effects must not
  expose unseen activity or reconnect old trails. Obtain human acceptance of their strength and style.
- Cover emission/lifetime/culling behavior at the lowest useful layer, measure the cost with many
  visible emitters, and run the applicable gates from `docs/TESTING.md` if adopted.
