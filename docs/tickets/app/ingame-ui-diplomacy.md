# Redesign diplomacy with actionable relations and tribute

**Area:** app · **Focus:** in-game UI redesign · **Priority:** P2

`hud/tool-panel/diplomacy/` shows relations and tribute, but the player cannot change an attitude.
In the original the window lists only encountered nations and shows both directions of each
relation; the player sets their own attitude to friendly, neutral or hostile unless the map script
locked it, trade needs the other side friendly, and a tribute offer shows the required goods, the
warehouse stock (goods at workplaces or homes do not count) and the payment action. The manual also
shows nation positions on a map, unconfirmed against the running original.

## Scope

- Design nation rows and details, both attitude directions, trade eligibility, script locks, tribute
  costs, available warehouse goods and feedback. Follow the HUD panel rules in `packages/app/AGENTS.md`.
- Open diplomacy directly from the beam. Inspect the diplomacy commands before wiring attitude
  changes; keep script authority and multiplayer ownership.
- Show nation locations only as far as the player legitimately knows them. Check the original's map
  separately instead of inventing what is visible.
- Coordinate with `docs/tickets/features/map-scripts-runtime-fidelity.md` for tribute semantics.

## Verify

Test unmet nations, asymmetric relations, locks, insufficient tribute, repeated payment and stock
scope. Inspect ownership and command results in the diplomacy scene and on a real map, and provide the
verified preview.
