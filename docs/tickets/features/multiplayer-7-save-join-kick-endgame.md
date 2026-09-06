# Save, load, late join, kicked seats, and the end of a networked game

**Area:** app, sim · **Focus:** save-load, session lifecycle · **Priority:** P2
**Blocked by:** [multiplayer-6-lobby.md](multiplayer-6-lobby.md)

The save format is the resync primitive: `exportSaveGame` and `restoreSimulation` round-trip to an
identical hash (the fuzz suite proves it), a save is about 1.3 MB after gzip, and every client in a
lockstep game holds the same state, so any client can produce the save. A networked save omits
tick-targeted pending envelopes, as the sim seams ticket defines, and the server's frames after the
saved tick reconstruct them. What is missing is the lifecycle around it in a networked session, and a
terminal game state: the sim has none, the features ticket for skirmish victory and defeat covers the
rule, and a networked match without an outcome cannot end.

## Scope

- Save in game by any player: the file carries the session descriptor and the seat roster (nicks and
  seat modes, never tokens) so it can seed a new room, and the client uploads it to the room's cached
  snapshot slot.
- Load: creating a room from a save; the server delivers the save to every joiner through the blob
  relay, seats are matched by nick with the creator resolving the rest, and Start restores every
  client from the same bytes at the same tick.
- Late join and rejoin: a joiner into a running game, or a player returning after the countdown, gets
  the room's cached snapshot (or one from a reference client when none is cached yet) and the frames
  since, then catches up.
- Kick fallout: a kicked seat becomes idle or AI as the lobby chose; the AI case uses the server's
  single allowlisted trusted command and takes effect on a known tick on every client.
- End of game: the skirmish victory and defeat rule reports per seat; the app shows the local result,
  the room returns to the lobby with the roster intact, and the server stops the clock.
- Non-goals: no persistent server-side game history, no replays, no observers.

## Verify

- Headless through the server: a client disconnects for 30 s, rejoins, and finishes with the majority
  hash; a room created from a save starts every client at the saved tick with identical hashes; a late
  joiner from the cached snapshot matches.
- Kick: after the countdown and a passing vote, the seat's mode changes on every client on the same
  tick and hashes agree.
- End of game: a two-seat elimination emits the outcome on the same tick on both clients and returns
  both to the lobby.
- `npm run check`, `npm run build`, `npm test`, `npm run test:content` where content exists, plus a
  human pass over save, load, and the end-of-game surface.
