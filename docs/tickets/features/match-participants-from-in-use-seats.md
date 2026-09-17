# Judge the match over every in-use seat, not the lobby's claimable ones

**Area:** sim, app · **Focus:** `packages/sim/src/systems/match` · **Priority:** P2
**Needs user:** confirm that campaign maps may start announcing defeat and victory, which follows from
the engine's own rule but changes 96 of the 124 decoded maps.

`matchParticipants` (`packages/app/src/game/match-participants.ts`) builds the participant list from the
session's human and AI seats. A map's own computer seats (authored `ai`, offered to nobody) are AI
seats in every session now, so they count; a claimable seat left idle by the lobby still does not,
although the map puts its people in use.

Byte evidence from the owned copy's `the original`, cross-read against the the original's
`an original routine`: the engine's per-tick check loops every one of the 20 slots,
skipping only "not in use", "already dead" and the `playerneverdies` exemption flag. Claimability is a
lobby concept the check never sees.

## Scope

- Declare the match over every seat the map puts in use, idle claimable seats included, minus the
  `playerneverdies` exemptions, so the defeat half matches the engine.
- Keep the mutual-friends victory rule as the named approximation it is, and do not let it fire while a
  seat outside the winning group still holds a living adult man.
- Keep `playerneverdies` seats out of both halves, and keep a spectator seat out of the sheet's goal.
- The mission sheet's skirmish goal and the verdict overlay follow the same list, so a map that decides
  nothing promises nothing.
- A counted seat that starts with no adult man is dead at the first check, and in this build stays
  dead: the mark never lifts, the authority gate refuses the seat's orders and both AI handlers skip
  it (`systems/ai-player`, `systems/ai-program`). The original's handlers keep working for a dead seat
  (`an original routine` and `WorkOnAI` test only the handler's enabled byte), and the
  corpus relies on it: on script-victory maps the counted seats without an adult man are
  `wielka_bitwa_z_saracenami` 1, 2, 4, 6 (1 and 4 author 40 and 38 tasks, `CreateCreatures` among
  them, and the script hands them a town later through `ChangePlayerPlayerId` and `SetHuman`),
  `cn_2_dni_sub` 2, 3, 4, `zdradziecka_mielizna_sub2` 2 and `specjalna_forteca` 5 (one woman). Let
  a dead seat's program and orders run, or lift the mark when the seat gains an adult man.

## Verify

- Sim tests over a three-seat world where one seat is armed but idle: no victory while it stands,
  defeat for the seat whose last adult man dies.
- Headless pass over the decoded corpus: every map that declares a match lists every in-use seat.
- Browser: `?map=wichry_zimy&ai=5` ends only once seats 1-4 are gone; a campaign map (`?map=cn_2`)
  announces defeat when the player's last man dies.
