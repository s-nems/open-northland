# Add the network lobby

**Area:** app · **Focus:** entries/main-menu/lobby · **Priority:** P2
**Blocked by:** [multiplayer-5-electron-net-client.md](multiplayer-5-electron-net-client.md)

The single-player lobby in `packages/app/src/entries/main-menu/lobby/` already has a pure, DOM-free
roster model (`roster-state.ts`: seats, colours, vacant modes, observer seats) and produces the game
setup. The networked lobby is that model with several people claiming seats, a room list, identity,
readiness, and the checks that make a lockstep start safe.

Every client must build a byte-identical tick 0. Each player generates content locally from their own
game copy and mod, so a different mod version means different balance rows and a desync at the first
production cycle. A map edited by one player has the same effect. These mismatches must be caught in
the lobby, by name, before Start.

## Scope

- Menu flow: server address (defaulting to the project's server), nick, room list, create room (from a
  map or from a save), join room, leave.
- Room view: seats with colour, team, mode (human, ai, idle, closed as the vacant-seat ticket
  defines them), ready flags, the creator's settings (fog, progression, needs, starting speed, kicked
  seat fallout), and chat.
- Teams: chosen in the lobby, applied at start as trusted `setDiplomacy` setup commands from the
  descriptor, overriding the map script's rows.
- Fingerprints exchanged on join and re-checked at Start: content (the id tables from `ir.json`,
  `contentRevision`, mod version), map (the decoded map JSON and its script sidecar), client and
  protocol version. A mismatch blocks Start and names the player and the kind of mismatch.
- Missing map delivery: a joiner without the room's map receives it through the server's blob relay
  from the creator, verified against the fingerprint. Only maps outside the base game install are
  delivered (user maps, mod maps); a base-game map is expected locally because every owner's pipeline
  produces it.
- Start broadcasts the `GameSession` descriptor and every client boots the map entry from it.
- Localized text for every new surface.
- Non-goals: no accounts, no matchmaking, no observers.

## Verify

- The lobby model stays DOM-free and unit-tested: seat claims by several identities, duplicate-nick
  suffixes as the server reports them, team assignment, ready gating, and the mismatch outcomes.
- Two clients with different content fingerprints cannot start, and the message names the player.
- A modified map on one client is detected; a missing user map is delivered and verified; a missing
  base map is reported as missing, not delivered.
- Start on two clients produces identical hashes at tick 1.
- `npm run check`, `npm run build`, `npm test`, plus a human pass over the menu flow in Polish and
  English.
