# Judge the match over every in-use seat, not the lobby's claimable ones

**Area:** sim, app · **Focus:** `packages/sim/src/systems/match` · **Priority:** P2
**Needs user:** confirm that campaign maps may start announcing defeat and victory, which follows from
the engine's own rule but changes 96 of the 124 decoded maps.

`matchParticipants` (`packages/app/src/game/match-participants.ts`) builds the participant list from the
local seat plus the `?ai=` seats, and the lobby only offers seats the map marks claimable
(`multiplayer.humanOptionSlots`, `packages/content-resolver/src/maps-index.ts`). Scenario seats never
reach the list, so `matchSystem` neither kills them nor waits for them.

Two consequences over the decoded corpus (124 maps with a roster):

- 96 maps declare no match at all, because they expose fewer than two claimable seats. Intended today:
  their goals come from the mission script, which the repo shows but does not evaluate.
- 13 of the remaining 28 carry armed seats outside the match. `wichry_zimy` seats the player at 0 and
  offers AI on 5 (11 people each) while seats 1-4 hold 39, 84, 182 and 18 people with 15, 11, 10 and 4
  buildings. Wiping seat 5 raises "Wszyscy rywale w rozgrywce upadli" beside an untouched town of 182.
  `przekleta_kraina` (participants 0, 5, 6, 7 against outsiders holding 18, 17 and 119 people) and
  `cn_4` are the same shape.

Byte evidence from the owned copy's `GameMp.exe`, cross-read against the macOS build's
`CGameControl::System_DoOneGameTick`: the engine's per-tick check loops every one of the 20 slots,
skipping only "not in use", "already dead" and the `playerneverdies` exemption flag. Claimability is a
lobby concept the check never sees.

## Scope

- Declare the match over every seat the map puts in use, minus the `playerneverdies` exemptions, so the
  defeat half matches the engine. Seat modes from
  [vacant seat AI player](./vacant-seat-ai-player.md) are the natural source once that lands; until
  then the map script's `players` list is.
- Keep the mutual-friends victory rule as the named approximation it is, and do not let it fire while a
  seat outside the winning group still holds a living adult man.
- Keep `playerneverdies` seats out of both halves, and keep a spectator seat out of the sheet's goal.
- The mission sheet's skirmish goal and the verdict overlay follow the same list, so a map that decides
  nothing promises nothing.

## Verify

- Sim tests over a three-seat world where one seat is armed but unclaimable: no victory while it stands,
  defeat for the seat whose last adult man dies.
- Headless pass over the decoded corpus: every map that declares a match lists every in-use seat.
- Browser: `?map=wichry_zimy&ai=5` ends only once seats 1-4 are gone; a campaign map (`?map=cn_2`)
  announces defeat when the player's last man dies.
