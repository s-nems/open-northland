# Keep the notice column across a save and load

**Area:** app, sim · **Priority:** P3 · **Focus:** `hud/tool-panel/messages/`, save header

A save does not carry the notice feed. Loading reboots the page, so the column starts empty:

- every event note is gone for good: deaths, finished or upgraded houses, unlocks, diplomacy, found
  papers;
- `workplaceNotFound` never comes back, since the sweep's post history (`PostHistory` in
  `from-snapshot.ts`) starts over and no settler counts as ever employed;
- notes the player dismissed come back, and the filter level drops to the default.

State notes the sweep reads off the world (needs, dying, lost, family block, stalls, idle) return on
their own within about ten seconds, and a fight note returns on its next hit.

`MessageFeedState` (`feed.ts`) is already plain data that a HUD remount round-trips through
`MessageCenter.state()` and `restore()`. Entity ids are never reused and survive the save, so the
notes' subjects stay valid.

## Scope

- Carry the viewer's feed in the save as caller-owned opaque header data, the way `session` travels
  through `ExportSaveOptions`. Record the seat the feed belongs to. Bump the save format version and
  regenerate its fixture.
- On load, validate the shape (the file is untrusted input) and hand it to the message centre as its
  `initial` state, but only when the loading viewer holds the recorded seat. Any other viewer starts
  with an empty feed at its own default level, as it does today.
- In a relayed room the saver's file is shared and the whole room boots from it. The seat check keeps
  the saver's notes and filter level away from the other players. Keeping every player's own feed in a
  room load or a desync reload is out of scope.

## Verify

- Round-trip test: save with live notes, a dismissal and a raised filter level, load, and get the same
  feed back on the same seat and an empty default feed on another seat.
- A malformed feed in the header is rejected without breaking the load: the world boots with an empty
  feed.
- Browser: on a real map, let a house finish and a settler die, save, load. Both notes stand in the
  column without the slide-in animation.
