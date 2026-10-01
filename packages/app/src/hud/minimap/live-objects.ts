import { type MinimapFeature, type MinimapObjects, minimapFeatureOfGood } from '@open-northland/render/data';
import {
  cellOfNode,
  FOG_STATE,
  type FogView,
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

/** Count by node key, per sim good type. */
type CountsByGood = Map<number, Map<number, number>>;

export interface SeenStandingObjects {
  /** Whether {@link refresh} may change the picture: the standing nodes changed since the last refresh,
   *  or a difference still hidden may have come into view under a new fog view. */
  stale(snapshot: WorldSnapshot, fog: FogView | null): boolean;
  /** Take each node's live count where the viewer sees its cell now, or everywhere without fog; true
   *  when the picture changed. A full refresh walks the drawn goods' standing and seen nodes; a refresh
   *  under unchanged nodes rechecks only the differences fog hid. */
  refresh(snapshot: WorldSnapshot, fog: FogView | null): boolean;
  /** The picture as a baker's objects: one pass over the seen nodes. */
  objects(): MinimapObjects;
}

/**
 * The minimap's forest and ore as the viewer last saw them, so felling and mining in explored but
 * unseen ground stay hidden as the world view's fog ghosts keep them. Approximation: the first refresh
 * takes the standing nodes everywhere, so the mount-time picture is the authored or saved forest,
 * including what a rival worked before a save in ground the viewer never saw again.
 */
export function createSeenStandingObjects(
  featureOfGoodType: ReadonlyMap<number, MinimapFeature>,
): SeenStandingObjects {
  const seen: CountsByGood = new Map();
  /** Nodes whose live count differs from the seen one while fog hides their cell. */
  const hidden = new Map<number, Set<number>>();
  let seeded = false;
  let refreshedRevision = 0;
  /** The fog view the last refresh saw, by its seat and generation; null seat when fog was off. */
  let refreshedSeat: number | null = null;
  let refreshedGeneration = 0;

  const seenOf = (goodType: number): Map<number, number> => {
    let nodes = seen.get(goodType);
    if (nodes === undefined) {
      nodes = new Map();
      seen.set(goodType, nodes);
    }
    return nodes;
  };
  const visible = (fog: FogView | null, node: number): boolean => {
    if (fog === null) return true;
    const { cx, cy } = cellOfNode(node % NODE_KEY_ROW, Math.floor(node / NODE_KEY_ROW));
    return fog.stateAt(cx, cy) === FOG_STATE.VISIBLE;
  };
  /** Apply a differing live count where it shows; otherwise remember it as hidden. True when applied. */
  const take = (
    fog: FogView | null,
    nodes: Map<number, number>,
    hiddenNodes: Set<number>,
    node: number,
    live: number,
  ): boolean => {
    if (!visible(fog, node)) {
      hiddenNodes.add(node);
      return false;
    }
    if (live > 0) nodes.set(node, live);
    else nodes.delete(node);
    hiddenNodes.delete(node);
    return true;
  };

  return {
    stale: (snapshot, fog) => {
      if (!seeded || standingNodesRevision(snapshot, featureOfGoodType) !== refreshedRevision) return true;
      if (hidden.size === 0) return false;
      return (
        (fog?.player ?? null) !== refreshedSeat || (fog !== null && fog.generation !== refreshedGeneration)
      );
    },
    refresh: (snapshot, fog) => {
      const state = indexesOf(snapshot).get(STANDING_NODES);
      const revision = standingNodesRevision(snapshot, featureOfGoodType);
      const full = !seeded || revision !== refreshedRevision;
      const view = seeded ? fog : null;
      let changed = !seeded;
      for (const goodType of featureOfGoodType.keys()) {
        const live = state.get(goodType)?.countByNode;
        const nodes = seenOf(goodType);
        const hiddenNodes = hidden.get(goodType) ?? new Set<number>();
        if (full) {
          hiddenNodes.clear();
          for (const [node, count] of live ?? []) {
            if (nodes.get(node) !== count && take(view, nodes, hiddenNodes, node, count)) changed = true;
          }
          for (const node of nodes.keys()) {
            if (live?.has(node) !== true && take(view, nodes, hiddenNodes, node, 0)) changed = true;
          }
        } else {
          for (const node of hiddenNodes) {
            const count = live?.get(node) ?? 0;
            if ((nodes.get(node) ?? 0) === count) hiddenNodes.delete(node);
            else if (take(view, nodes, hiddenNodes, node, count)) changed = true;
          }
        }
        if (hiddenNodes.size > 0) hidden.set(goodType, hiddenNodes);
        else hidden.delete(goodType);
      }
      seeded = true;
      refreshedRevision = revision;
      refreshedSeat = fog?.player ?? null;
      refreshedGeneration = fog?.generation ?? 0;
      return changed;
    },
    objects: () => {
      const placements: number[] = [];
      for (const [goodType, feature] of featureOfGoodType) {
        const nodes = seen.get(goodType);
        if (nodes === undefined) continue;
        const type = MINIMAP_OBJECT_TYPES.indexOf(feature);
        for (const [node, standing] of nodes) {
          const hx = node % NODE_KEY_ROW;
          const hy = Math.floor(node / NODE_KEY_ROW);
          for (let i = 0; i < standing; i++) placements.push(hx, hy, type);
        }
      }
      return { types: MINIMAP_OBJECT_TYPES, placements };
    },
  };
}
