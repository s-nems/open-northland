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
- A counted seat that starts with no adult man is dead at the first check, and a dead seat's scripted
  program stops (`systems/ai-program`). Every such corpus seat is `playerneverdies`; the rule should
  not rely on that.

## Verify

- Sim tests over a three-seat world where one seat is armed but idle: no victory while it stands,
  defeat for the seat whose last adult man dies.
- Headless pass over the decoded corpus: every map that declares a match lists every in-use seat.
- Browser: `?map=wichry_zimy&ai=5` ends only once seats 1-4 are gone; a campaign map (`?map=cn_2`)
  announces defeat when the player's last man dies.
