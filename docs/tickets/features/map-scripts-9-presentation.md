# Present script events: cutscenes, sounds, camera, info lines, names, effects

**Area:** app, audio, pipeline · **Focus:** mission events · **Priority:** P2

Map-scripts epic, stage 9 of 10. Reference: [`docs/formats/MISSIONS.md`](../../formats/MISSIONS.md),
"Briefings and the mission window", "On-screen info lines". Depends on the mission window and the
`.briefing.json` sidecar from the victory-defeat branch being on `main`.

The sim emits presentation events for `PlayCutscene` (1,450 lines), `PlaySound` (498),
`SetCameraPosition` (197), `InfoClear` and `InfoShowString` (314), `SetHumanName` (138),
`SetWeather` (207), `StartEarthQuake` (122), `SelectHuman` (7), and the markers. Nothing consumes
them yet, and the app still opens the intro briefing by guessing the first `PlayCutscene` from the
raw script instead of listening to the sim.

## Scope

- Open the mission window on a `PlayCutscene` event with the page id, remember the replayable page
  and the shown history, and delete the intro-guessing helper once the sim drives it (keep it only
  for worlds with missions disabled).
- `PlaySound` through the audio bindings by `ATOMIC_ANIMATION_EVENT_SOUND_FX_TYPE_*` id at the
  point; `SetCameraPosition`; `SelectHuman`; `SetGuiMarker`.
- Info lines: five per player, cleared, static, or with a live count substituted into `%d`, drawn
  where the HUD has room and the original's docs put them (top right).
- `SetHumanName` from the map string table, and extract `[misc_humannames]` (`setname <humanId>
  <stringId>`) in the pipeline so placed humans get their names at build.
- `SetVisible` and the evaluated flag feed the mission window's goal list; the mission window also
  needs each mission's `description <stringId>`, which the stage-2 script join drops because no
  consumer read it. Carry it into `MissionDefinition` here.
- Route the `missionUnsupported` event into `diag` so a player's log names what a map asked for and
  did not get; today only tests read it.
- `PlayCutscene` ends the evaluation pass it fires in (the original raises a stop flag the pass loop
  checks after each mission). Stage 2 left the mechanism out because no opcode it implements raises
  it; add it with this opcode and pin it with a two-mission test.
- `SetWeather`, `StartEarthquake`, `SetMapAreaMarker*`, `SetImportLandscapeMarker` as events with a
  minimal visible reaction; richer effects can follow as their own tickets.
- Split into two sessions if needed: cutscene, sound, camera, selection, names first; info lines and
  effects second.

## Where to look

`packages/app/src/view/runtime/game-presentation.ts` and `game-view.ts` (how sim events reach the
view), `packages/app/src/hud/tool-panel/mission/` and `packages/app/src/game/mission-brief.ts` once
the victory-defeat branch lands, `packages/audio/src/data/bindings.ts`,
`tools/asset-pipeline/src/stages/maps/script.ts` (`misc.inc` sections), and the map's own string
table in `maps/<id>.strings.json` (per language, what `SetHumanName` and `InfoShowString` address).

## Verify

Unit tests for the event-to-window and event-to-audio joins. A scene on a real map opens the intro
page from the sim event and shows an info line; human review of the window, the line placement, and
one sound. Normal gates including `packages/app`.
