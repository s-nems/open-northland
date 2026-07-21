# Add deterministic skirmish victory and defeat

**Area:** sim + app · **Priority:** P1

The sim has no terminal game state. Eliminating every settler on one side leaves the match running
indefinitely, commands remain accepted, and the app cannot show an outcome. Authored campaign goals
are a separate mechanic; this ticket covers only a minimal skirmish rule and must name it as an
approximation until original behavior is observed.

## Scope

- Record a deterministic terminal result in sim state and emit it once when a participating player
  loses the last entity required by the chosen skirmish rule. Evaluation must scale with players or
  relevant entity changes, not entity pairs.
- Define deterministic post-game command behavior.
- Show the local player's result in the app and provide a way back to the menu.
- Do not interpret `MissionData` goals or results in this ticket.

## Verify

- Unit test: defeat fires exactly once when the last qualifying entity dies, with no false positive
  before a participating player has spawned.
- Headless scenario: two-player fight to elimination emits victory/defeat events deterministically
  (same seed, same tick).
- Browser pass: the end-of-game surface appears and returns to the menu.
- `npm test`, `npm run check`, `npm run build`; name any intentional golden change.
