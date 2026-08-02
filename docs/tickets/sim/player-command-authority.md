# Enforce issuing-player authority at the command boundary

**Area:** sim, app · **Priority:** P3

`UnitOrderCommand` identifies the unit to control but not the player issuing the order. Its shared guard
only proves that the unit has an `Owner`, so the sim cannot enforce the commands' stated "owned unit"
contract: any external command producer can direct any player's settler. Placement and spawn commands
have the related ambiguity that an explicit out-of-range `owner` is accepted and creates a neutral
entity through `stampOwner`.

The current UI filters the local player's selection, but the command boundary is also the replay input
and the intended lockstep seam. Authority must be represented there rather than depending on every
caller to filter correctly.

## Scope

- Distinguish trusted setup/admin inputs from player-issued commands and carry the issuing player on
  the latter without giving player input access to setup-only options such as forced placement.
- Validate that a player controls the ordered unit and any player-owned assignment target before
  applying a unit order. Preserve diplomacy as a relationship between players, not permission to
  control an ally's entities.
- Reject an explicit invalid owner before a spawn or placement creates an entity. Keep an omitted owner
  available to trusted authored setup and neutral fixtures.
- Update app command producers, serialized diagnostics/replay inputs, and exhaustive command dispatch
  without adding an ambient "current player" resource to the deterministic sim.

## Verify

Tests prove player 0 cannot order player 1's unit, cannot assign it to a workplace, and cannot create a
neutral entity through an invalid explicit owner; trusted setup can still create an intentionally
unowned fixture. Replay the same authorized command log twice and compare hashes. Run `npm test`,
`npm run check`, and `npm run build`.
