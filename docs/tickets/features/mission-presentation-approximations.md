# Present scripted weather, selection and verdicts like the original

**Area:** app, render · **Focus:** `packages/app/src/view/runtime/script-presentation.ts` · **Priority:** P3

Three presentation results are stated approximations in `docs/formats/MISSIONS.md`:

- `SetWeather` (207 corpus uses) and the `[misc_weather]` rectangles draw as a screen wash by the
  density at the view's centre. Establish how the original draws rain, snow and sand over its
  10-node sectors and draw the same over the visible sectors, screen-bounded.
- `SelectHuman` (7): the view centres once; the original follows the human with the camera.
- On a multiplayer map `MissionWon` and `MissionFailed` only raise goal-table rows, and the verdict
  is announced at the next 120-tick goal check; the original still shows the won/lost message and
  jingle the moment the result runs (stated in `missions/results/standing.ts`).

## Scope

- Implement each through the existing presentation events; keep the sim's events and saved
  presentation state unchanged unless the original's behavior needs more.
- Rewrite the "Here:" texts and the `standing.ts` comment.

## Verify

- App tests for the follow camera (stops when the human is gone or the player moves the view) and
  for the immediate verdict message without a duplicate at the goal check.
- Browser check on a map with `SetWeather` (screenshot, frame cost measured in the scenario) and on
  one with `SelectHuman`, in a muted browser.
