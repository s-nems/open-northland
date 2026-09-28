# Release the people a handed-over building still holds for their old owner

**Area:** sim · **Focus:** missions, economy, conflict, defence · **Priority:** P2

`ChangeHousesPlayerId` (`handHousesToPlayer` in `systems/missions/results/ownership.ts`, used by 28
corpus maps per `docs/formats/MISSIONS.md`) only re-stamps the building's `Owner`. Everyone bound to
the building or waiting inside it keeps serving their old seat from the new seat's house:

- `JobAssignment.workplace`: `boundWorkplaceTarget` (`settlers/targets/workplaces.ts`) and
  `towerPostFor` (`conflict/tower-post.ts`) check the building's tribe, never its owner, so a
  craftsman keeps working the house and a garrison keeps shooting from a tower the enemy now owns;
- `Residence.home`: the family keeps living in, eating from and stocking the other seat's house;
- `Sheltering.shelter`: `shelterStillHolds` (`defence/shelters.ts`) checks the building only, and the
  shelter ledger counts the old seat's claims against the new seat's room.

The order gates already refuse this state: `economy/jobs/openings.ts` rejects another player's
workplace, and the drill rung (`settlers/drives/training.ts`) drops a barracks or school on the other
side.

Rule (owner's decision): a person whose owner differs from the building's owner is released - unbound
and stepped out of the building. A person on the same side as the building stays. Whether the original
evicts is unverified; this is the chosen behavior, not a reading.

## Scope

- After a tick's mission results have all run, release every person bound to or inside a building
  whose owner the pass changed, when the person's owner now differs from the building's: drop the
  workplace binding (as `releaseEmployment` does), the home, the shelter claim (`releaseShelter`) and
  a garrison post, and step it out (`stepOut`). Comparing sides once at the end of the pass makes the
  order of results irrelevant: people handed along with their buildings in the same tick, as
  `ChangePlayerPlayerId` does, keep their bindings.
- `ChangeHumanPlayerId` and `ChangePlayerIdInArea` keep detaching the humans they hand over from their
  houses (reading, `MISSIONS.md`); this ticket does not change that.
- A player-initiated capture, if one is added later, should go through the same release.

## Verify

- Mission result tests: hand a manned tower, a staffed workshop, an occupied home and a shelter on
  alarm to another seat with `ChangeHousesPlayerId`; each person loses its binding, stands outside,
  and the tower no longer shoots for the old seat.
- The same buildings plus their people handed by `ChangePlayerPlayerId` in the same tick keep every
  binding; `ChangeHousesPlayerId` followed by `ChangePlayerPlayerId` in one result list does too.
- `MISSIONS.md` row 35 names the release. `npm test`; state hashes move only where a scene hands a
  building over, with the commit naming it.
