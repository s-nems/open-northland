import { diplomacyStance, type IntelBuilding, MAX_PLAYERS } from '../../../../components/index.js';
import type { DeepReadonly, Entity, World } from '../../../../ecs/world.js';
import { everyBuildingOf } from '../../../ai-shared/home-roster.js';
import { anchorNodeOf } from '../../../ai-shared/node-geometry.js';
import type { SystemContext } from '../../../context.js';
import { fogHides, playerSeesNode } from '../../../vision/gates.js';
import { rememberedBuildings } from './read.js';

/** The buildings a seat believes stand, split by what it may read of them. */
export interface BelievedBuildings {
  /** The ones whose spot it sees now, read live, ascending id; with nothing hidden, every one asked for. */
  readonly seen: readonly Entity[];
  /** The remembered ones whose spot it does not see, as last seen, ascending id. One may since have fallen
   *  or changed hands: it stays a place to go and look, so read only its record, never its entity. */
  readonly remembered: readonly DeepReadonly<IntelBuilding>[];
}

const NOTHING_REMEMBERED: readonly DeepReadonly<IntelBuilding>[] = [];
const NO_BUILDINGS: readonly Entity[] = [];

/**
 * The buildings `seat` believes stand, of `owner`, or of every owner it holds an `enemy` stance toward now
 * when null. A remembered building leaves the belief only when the seat sees its spot again (then it is
 * read live, or forgotten if gone). The live state of a seen building is the caller's to read.
 */
export function believedBuildings(
  world: World,
  ctx: SystemContext,
  seat: number,
  owner: number | null = null,
): BelievedBuildings {
  const owns = (other: number): boolean => (owner === null ? isEnemy(world, seat, other) : other === owner);
  const live = owner === null ? enemyBuildings(world, seat) : everyBuildingOf(world, owner);
  const fog = ctx.fog;
  if (!fogHides(fog)) return { seen: live, remembered: NOTHING_REMEMBERED };
  const seen: Entity[] = [];
  for (const e of live) {
    const node = anchorNodeOf(world, e);
    if (node !== null && playerSeesNode(fog, seat, node.hx, node.hy)) seen.push(e);
  }
  const remembered = rememberedBuildings(world, seat).filter(
    (b) => owns(b.owner) && !playerSeesNode(fog, seat, b.hx, b.hy),
  );
  return { seen, remembered };
}

function isEnemy(world: World, seat: number, other: number): boolean {
  return other !== seat && diplomacyStance(world, seat, other) === 'enemy';
}

/** The buildings of every owner `seat` holds an `enemy` stance toward, ascending id. */
function enemyBuildings(world: World, seat: number): readonly Entity[] {
  let only: readonly Entity[] | null = null;
  let merged: Entity[] | null = null;
  for (let other = 0; other < MAX_PLAYERS; other++) {
    if (!isEnemy(world, seat, other)) continue;
    const roster = everyBuildingOf(world, other);
    if (roster.length === 0) continue;
    if (only === null) only = roster;
    else {
      merged ??= [...only];
      for (const e of roster) merged.push(e);
    }
  }
  return merged === null ? (only ?? NO_BUILDINGS) : merged.sort((a, b) => a - b);
}
