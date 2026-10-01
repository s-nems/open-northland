import { type MinimapFeature, type MinimapObjects, minimapFeatureOfGood } from '@open-northland/render/data';
import {
  firstDifference,
  indexesOf,
  nodeOfPosition,
  type SnapshotIndexSpec,
  type WorldSnapshot,
} from '@open-northland/sim';
import { num, positionOf, type SnapshotEntity } from '../../game/snapshot.js';
import { MINIMAP_OBJECT_TYPES } from './bake.js';

/**
 * The minimap's forest and ore from the standing harvestable nodes the sim holds now, so a felled
 * tree, a planted one and a worked-out deposit show once the surface rebakes. A map's harvestable
 * placements spawn as these nodes, so a fresh world draws what the map authored.
 */

/** One good's standing nodes: how many stand on each half-cell node, and a count of the changes. */
interface GoodNodes {
  readonly countByNode: Map<number, number>;
  revision: number;
}

type StandingNodes = Map<number, GoodNodes>;

/** A node key packs `(hx, hy)` as `hy * NODE_KEY_ROW + hx`, wider than any map's lattice row. */
const NODE_KEY_ROW = 1 << 16;

function standingNodeOf(entity: SnapshotEntity): { goodType: number; node: number } | undefined {
  const resource = entity.components.Resource as { goodType?: unknown } | undefined;
  const goodType = num(resource?.goodType);
  const position = positionOf(entity);
  if (goodType === undefined || position === undefined) return undefined;
  const { hx, hy } = nodeOfPosition(position.x, position.y);
  return { goodType, node: hy * NODE_KEY_ROW + hx };
}

function count(state: StandingNodes, entity: SnapshotEntity, delta: number): void {
  const standing = standingNodeOf(entity);
  if (standing === undefined) return;
  let good = state.get(standing.goodType);
  if (good === undefined) {
    good = { countByNode: new Map(), revision: 0 };
    state.set(standing.goodType, good);
  }
  const left = (good.countByNode.get(standing.node) ?? 0) + delta;
  if (left > 0) good.countByNode.set(standing.node, left);
  else good.countByNode.delete(standing.node);
  good.revision++;
}

/** The counts alone: a revision depends on the history, not the entities. */
function countsOf(state: StandingNodes): Map<number, Map<number, number>> {
  const out = new Map<number, Map<number, number>>();
  for (const [goodType, good] of state) {
    if (good.countByNode.size > 0) out.set(goodType, good.countByNode);
  }
  return out;
}

const STANDING_NODES: SnapshotIndexSpec<StandingNodes> = {
  name: 'minimap standing nodes',
  // A resource node never moves, so its position is read only when it is placed.
  reads: { values: ['Resource'], presence: ['Position'] },
  empty: () => new Map(),
  add: (state, entity) => count(state, entity, 1),
  remove: (state, entity) => count(state, entity, -1),
  replace: (state, previous, next) => {
    const before = standingNodeOf(previous);
    const after = standingNodeOf(next);
    if (before?.goodType === after?.goodType && before?.node === after?.node) return;
    count(state, previous, -1);
    count(state, next, 1);
  },
  differs: (held, fresh) => firstDifference(countsOf(held), countsOf(fresh)),
};

/** The goods the minimap draws a standing node of, by sim good type. */
export function minimapFeatureOfGoodTypes(
  goods: readonly { readonly id: string; readonly typeId: number }[],
): ReadonlyMap<number, MinimapFeature> {
  const out = new Map<number, MinimapFeature>();
  for (const good of goods) {
    const feature = minimapFeatureOfGood(good.id);
    if (feature !== undefined) out.set(good.typeId, feature);
  }
  return out;
}

/** A number that grows whenever a drawn good's standing nodes change. */
export function standingNodesRevision(
  snapshot: WorldSnapshot,
  featureOfGoodType: ReadonlyMap<number, MinimapFeature>,
): number {
  const state = indexesOf(snapshot).get(STANDING_NODES);
  let revision = 0;
  for (const goodType of featureOfGoodType.keys()) revision += state.get(goodType)?.revision ?? 0;
  return revision;
}

/** The standing nodes of the drawn goods as a baker's objects: one pass over them. */
export function standingObjects(
  snapshot: WorldSnapshot,
  featureOfGoodType: ReadonlyMap<number, MinimapFeature>,
): MinimapObjects {
  const state = indexesOf(snapshot).get(STANDING_NODES);
  const placements: number[] = [];
  for (const [goodType, feature] of featureOfGoodType) {
    const nodes = state.get(goodType);
    if (nodes === undefined) continue;
    const type = MINIMAP_OBJECT_TYPES.indexOf(feature);
    for (const [node, standing] of nodes.countByNode) {
      const hx = node % NODE_KEY_ROW;
      const hy = Math.floor(node / NODE_KEY_ROW);
      for (let i = 0; i < standing; i++) placements.push(hx, hy, type);
    }
  }
  return { types: MINIMAP_OBJECT_TYPES, placements };
}
