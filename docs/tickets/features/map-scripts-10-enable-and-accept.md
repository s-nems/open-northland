# Accept mission scripts through a complete campaign

**Area:** sim, app · **Focus:** acceptance · **Priority:** P2

Map-scripts epic, stage 10 of 10. Fresh maps execute their scripts automatically; `missions=off`
remains a diagnostic override. Enabled scripted maps use reveal fog unless overridden, track deaths
over authored seats minus `playerneverdies`, and
leave victory to script results. Saved markers, weather and mission execution history restore.
`?scene=mission-map` exercises the untouched `wielkie_sprzatanie` opening, reinforcements and save/load.
This source declares a single-player free map, not a campaign; its ending remains unaccepted.

## Verified blockers

- `cn_1` has no `MissionWon`: it returns through unsupported `EndSubMission`. Parent `cn_0` needs
  `StartSubMission` and vehicle ownership changes. Neither is a standalone campaign acceptance case.
- Owned `DataX/Libs/data0001.lib` contains base campaign maps; the current map pipeline serves loose
  map directories. The first base mission, `campaign_03_01`, requires `DockVehicle` and
  `StartSubMission` on its story path. Extracting it alone does not make it completable.
- `wielkie_sprzatanie` uses only implemented opcode handlers, but winning requires defeating seats 2
  and 3 through actual gameplay, then missions 72 and 77. The bounded reinforcement test does not
  establish that its economy, recruitment and combat can complete that route.
- `AllowJob`, `AllowHouse`, `AllowGood` and `SetExternalFlag` retain flags with no gameplay consumer;
  the building unlock gate remains disabled. Static opcode coverage is not completion evidence.

## Scope

- Establish a genuine completed campaign route with an intact script and ordinary player actions.
  Do not substitute forced goals, removed enemies, administrative spawns or injected verdicts.
  Automatic execution does not waive this acceptance prerequisite.
- Observe the running original for the 3-second evaluation cadence, activation-relative `TimeGone`,
  `RandomTimeGone` bounds and whether the load tick evaluates. Keep current unconfirmed readings
  explicit in [`MISSIONS.md`](../../formats/MISSIONS.md); add a load pass only with evidence.
- Observe tribute notification behavior before adding a new cue; coordinate with the messages work.
- Check terrain fidelity: FX removal memberships, palette multiplication, `SetLandscape` size and
  final flag. Chest imagery does not implement interaction or payload.
- Verify faction discovery opens the authored briefing, pauses play and reveals the next goals in
  the browser. Saved briefing history must remain navigable after restore.

Vehicles, sub-missions, chests, guides, wall gates, campaign unlocks, FMV and the trade ledger remain
outside this ticket's implementation scope. Their absence is a dependency, not an acceptance waiver.
Human review of the intro, combat and ending remains part of final epic acceptance.

## Verify

Run `check:assets`, `check:docs`, `check`, `build`, `test`, `test:content` and the coverage report in
the authorized worktree. Accept an intact campaign's intro, combat, ending and save/load continuation.
Any merge and validation on primary `main` require the user's separate merge instruction. List any
intentional golden changes.
