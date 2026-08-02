# Own and authorize external commands at the simulation boundary

**Area:** sim, app · **Focus:** core/commands · **Priority:** P2

`UnitOrderCommand` identifies the unit to control but not the player issuing the order. Its shared guard
only proves that the unit has an `Owner`, so the sim cannot enforce the commands' stated "owned unit"
contract: any external command producer can direct any player's settler. Placement and spawn commands
have the related ambiguity that an explicit out-of-range `owner` is accepted and creates a neutral
entity through `stampOwner`.

The current UI filters the local player's selection, but `CommandQueue.enqueue` accepts an unowned
`Command` reference and retains that caller-owned object for later execution and replay. Imported replay
or diagnostics JSON consequently has no runtime-validated authority boundary, while a caller that mutates
a queued payload can also change the future input after enqueue. This boundary is a prerequisite for the
versioned save format: persisted pending inputs must retain who was allowed to issue them and must not
depend on ambient UI state.

## Scope

- Replace the public bare-command input with a serializable, versioned envelope that distinguishes
  player, AI, trusted setup, and admin origins. Carry a player id for player and AI origins without
  adding an ambient "current player" resource to the sim.
- Give each normalized enqueue a monotonic sequence owned by the queue. Preserve `(applyTick, sequence)`
  in the replay log so ordering remains explicit when commands from different origins share a tick.
- Validate and normalize imported envelopes at the replay/diagnostics boundary. The queue must retain
  an owned plain-data value, not an alias to a caller's mutable object.
- Validate that a player controls the ordered unit and any player-owned assignment target before
  applying a unit order. Preserve diplomacy as a relationship between players, not permission to
  control an ally's entities.
- Reject an explicit invalid owner before a spawn or placement creates an entity. Keep an omitted owner
  available to trusted authored setup and neutral fixtures.
- Update app, authored setup, AI, diagnostics, and replay producers. Setup/admin-only options such as
  forced placement must be unrepresentable in a player envelope.
- Keep command acceptance/rejection reasons out of this ticket; the dependent
  [command-admission-outcomes](command-admission-outcomes.md) ticket owns that result channel.

## Verify

Tests prove player 0 cannot order player 1's unit, cannot assign it to a workplace, and cannot create a
neutral entity through an invalid explicit owner; trusted setup can still create an intentionally
unowned fixture. Mutating a source object after enqueue does not change the queued or logged envelope;
malformed imported envelopes fail with a readable validation error. Replay the same authorized log twice
and compare hashes and `(applyTick, sequence)` order. Run `npm test`, `npm run check`, and `npm run build`.
