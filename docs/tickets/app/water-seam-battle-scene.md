# Register a battle acceptance scene with a water seam

**Area:** app · **Priority:** P3

Every registered scene builds its map from `grassTerrain` (`packages/app/src/scenes/*.ts`), except
`berries.ts`. No scene therefore has two static walk components, so the whole combat-reachability
family - the chase's cross-bank release (`conflict/chase.ts`), the acquisition gate that now rejects a
candidate whose reach band lies entirely on the far bank (`conflict/target-node.ts`
`reachableTargetGate`), and the archer that walks up its own bank to shoot over the water - has
headless coverage only. Those three rules decide what a player sees a shore rank do, and nobody has
watched them.

## Scope

- Add a `battle.ts` variant (or a `terrain` option on it) whose map carries a full-height water column,
  with a melee rank and an archer on one bank and enemies on both.
- Register it in `packages/app/src/scenes/index.ts` like the others.
- Name in the scene's own description what to watch: the melee rank walking to the reachable flank
  instead of bunching at the waterline, the archer opening fire across the column, and the selected
  unit's panel state not alternating between engaged and idle.

## Verify

- `npm run check`, `npm run build`, `npm test`.
- Human: open the scene, select a shore rank, and confirm the three behaviors above.
