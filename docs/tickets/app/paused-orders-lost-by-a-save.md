# Carry the orders a paused single-player session is holding into its save

**Area:** app · **Focus:** save-load, lockstep driver · **Priority:** P3

An order issued while the game is paused does not reach the save file. `issueCommand`
(`view/runtime/game-view.ts`) hands the envelope to `LockstepDriver.submit`, which parks it in the
transport until the tick it applies at runs. A paused session never runs that tick, and
`exportSaveGame` writes `CommandQueue.pendingSnapshot()`, which deliberately omits tick-targeted
envelopes. So: pause, give a few orders, open the system menu, save. The running session still applies
them on the next unpause, but the saved file does not carry them and the loaded game has lost them.

Before the session driver the same orders went to `sim.enqueue`, landed in the untargeted queue, and
the save carried them.

A networked session has no such gap by design: the server's frames after the saved tick reconstruct
what was in flight (`multiplayer-7-save-join-kick-endgame.md`). Single-player has no server frames, so
it needs its own answer.

## Scope

- Decide where a not-yet-applied order lives for a single-player save, and make save and load agree.
  Moving it back into the untargeted queue at save time is not it: the order would then apply at a
  different position in its tick depending on whether a save was taken.
- Do not change the save format for it: a save omits tick-targeted envelopes by design.

## Verify

- Pause a map session, issue two orders, save, load: both orders are still queued and apply on the
  first tick of the restored session, in the order they were given.
- The state hash of a session that saved and reloaded matches one that never saved.
