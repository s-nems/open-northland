# Accept a complete authored map-script route

**Area:** sim, app · **Focus:** acceptance · **Priority:** P2

Map-scripts epic, stage 10 of 10. Fresh maps execute their scripts automatically; `missions=off`
remains a diagnostic override. Enabled scripted maps use reveal fog unless overridden, track deaths
over authored seats minus `playerneverdies`, and
leave victory to script results. Saved markers, weather and mission execution history restore.
`?scene=mission-map` opens the untouched `wielkie_sprzatanie` script. Its headless acceptance covers
the opening, Frank contact, reinforcements, a subsequent story encounter and save/load continuation.
This source declares a single-player free map, not a campaign; its ending remains unaccepted.

Browser checks confirm Frank contact opens page 511 and pauses play. After restore, the state hash
matches and the briefing arrows navigate between pages 500 and 511. The authored contact makes
mission 82 visible but supplies no description; the goal tab correctly retains the main victory
objective. This contact does not establish presentation of a newly described objective.

A browser probe with control scripts over two real custom maps covers sub-mission entry, saving
through the game menu, reloading the child and returning to the suspended parent. It validates the
world handover and save stack, not either map's unmodified story route.

## Verified blockers

- `cn_1` has no `MissionWon`: it returns through `EndSubMission`. The parent/submap handover is implemented,
  but parent `cn_0` still needs vehicle ownership changes. Neither is a standalone campaign acceptance case.
- `wielkie_sprzatanie` uses only implemented opcode handlers, but winning requires defeating seats 2
  and 3 through actual gameplay, then missions 72 and 77. The bounded reinforcement test does not
  establish that its economy, recruitment and combat can complete that route.
- `SetExternalFlag` retains flags with no AI-condition consumer. Natural technology prerequisites
  still use living workers rather than permanent discovery; see MISSIONS.md for the approximation.
  Static opcode coverage is not completion evidence.

## Scope

Campaign maps stored in archives are excluded; no archive extraction is required for this epic.

- Establish a genuine completed loose-map story route with an intact script and ordinary player actions.
  Do not substitute forced goals, removed enemies, administrative spawns or injected verdicts.
  Automatic execution does not waive this acceptance prerequisite.
- Observe the running original for the 3-second evaluation cadence, activation-relative `TimeGone`,
  `RandomTimeGone` bounds and whether the load tick evaluates. Keep current unconfirmed readings
  explicit in [`MISSIONS.md`](../../formats/MISSIONS.md); add a load pass only with evidence.
- Observe tribute notification behavior before adding a new cue; coordinate with the messages work.
- Check terrain fidelity: FX removal memberships, palette multiplication, `SetLandscape` size and
  final flag. Chest imagery does not implement interaction or payload.
- Verify a story transition with a newly described visible objective in the browser, beyond the
  already checked Frank contact and restored briefing navigation.

Vehicle and chest integration are tracked in [vehicles](map-scripts-vehicles.md) and
[chests](map-scripts-chests.md). DetectGuide integration, wall gates, campaign unlocks, FMV and the trade ledger remain
outside this ticket's implementation scope. Their absence is a dependency, not an acceptance waiver.
Human review of the intro, combat and ending remains part of final epic acceptance.

## Verify

Run `check:assets`, `check:docs`, `check`, `build`, `test`, `test:content` and the coverage report in
the authorized worktree. Accept an intact loose map's intro, combat, ending and save/load continuation.
Any merge and validation on primary `main` require the user's separate merge instruction. List any
intentional golden changes.
