import type { World } from '../../../../ecs/world.js';

/** Per-world count of work-flag RELOCATIONS: `componentGeneration` sees only add/remove, and a flag is
 *  the one blocker that moves in place, so this version seam counts moves explicitly. */
const flagMoves = new WeakMap<World, number>();

/** Record one work-flag relocation, invalidating every `workFlagBlockerVersion`-keyed memo. Bumped by
 *  the single relocate seam (`relocateWorkFlag`). */
export function noteWorkFlagMove(world: World): void {
  flagMoves.set(world, (flagMoves.get(world) ?? 0) + 1);
}

export function workFlagMoveCount(world: World): number {
  return flagMoves.get(world) ?? 0;
}
