# Save, load, late join, kicked seats, and the end of a networked game

**Area:** app, sim · **Focus:** save-load, session lifecycle · **Priority:** P2
**Blocked by:** [multiplayer-6-lobby.md](multiplayer-6-lobby.md)

The save format is the resync primitive: `exportSaveGame` and `restoreSimulation` round-trip to an
identical hash (the fuzz suite proves it), a save is about 1.3 MB after gzip, and every client in a
lockstep game holds the same state, so any client can produce the save. The relay side of that is in
place (`docs/NETWORK.md`): a `save` blob refreshes the room's cached snapshot, a returning token is
served the cache and the frames since, a kicked seat falls to idle or to the AI on one announced
tick, and the headless client proves each path. What is missing is the lifecycle around it in the
app, joining a room that is already running, and a terminal game state: the sim has none, the
features ticket for skirmish victory and defeat covers the rule, and a networked match without an
outcome cannot end.

## Scope

- Save in game by any player: the file carries the session descriptor and the seat roster (nicks and
  seat modes, never tokens) so it can seed a new room, and the client uploads it to the room's cached
  snapshot slot.
- Load: creating a room from a save; the server delivers the save to every joiner through the blob
  relay, seats are matched by nick with the creator resolving the rest, and Start restores every
  client from the same bytes at the same tick.
- Late join: `joinRoom` into a running room, refused today, admits a joiner to a vacant seat or as
  an observer; the joiner is served the cached snapshot (or one requested from a reference client
  when none is cached yet) and the frames since, the way a returning token is, then catches up. A
  player kicked out comes back this way, since its token is a stranger to the room. The cache can be
  up to five minutes old, which is thousands of ticks to replay while the room waits; serve a fresh
  snapshot instead when the cache trails the clock by more than the lag budget.
- Kicked seats in the app: the seat's change of hands reaches the sim through the relay's frame
  already; the HUD and the roster must show it.
- End of game: the skirmish victory and defeat rule reports per seat; the app shows the local result,
  the room returns to the lobby with the roster intact, and the server stops the clock.
- Non-goals: no persistent server-side game history, no replays, no observers.

## Verify

- Headless through the server: a room created from a save starts every client at the saved tick with
  identical hashes; a late joiner from the cached snapshot matches, and one admitted before any
  snapshot is cached is served one from a reference client.
- End of game: a two-seat elimination emits the outcome on the same tick on both clients and returns
  both to the lobby.
- `npm run check`, `npm run build`, `npm test`, `npm run test:content` where content exists, plus a
  human pass over save, load, and the end-of-game surface.
