import { Building } from '../../../../components/index.js';
import { contentIndex } from '../../../../core/content-index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { HalfCellNode } from '../../../../nav/halfcell.js';
import type { SystemContext } from '../../../context.js';
import { liveWorkFlag } from '../../../economy/work-flag.js';
import { buildingTypeByContentId, tiersAtOrAbove } from '../../content-lookup.js';
import { anchorNodeOf } from '../../node-geometry.js';

/** The workshop a good's gatherers supply, and how many of its holders do (all when `posts` is absent). */
interface CollectorWorkshop {
  readonly building: string;
  readonly posts?: number;
}

/** Which workshops a good's flags serve, by stable content ids (authored). Its first `posts` holders gather
 *  beside the seat's buildings of that upgrade chain, lowest id first and round-robin, so the craftsman's
 *  walk to his raw goods stays short; the rest gather beside the base, for goods the construction sites
 *  take too. */
export const COLLECTOR_WORKSHOP_BY_GOOD_ID: Readonly<Record<string, CollectorWorkshop>> = {
  mud: { building: 'work_pottery_00' },
  stone: { building: 'work_mason_hut_00', posts: 1 },
  iron: { building: 'work_smithy_01' },
  gold: { building: 'work_coin_mint' },
  mushroom: { building: 'work_druid_01' },
};

/** Where one decision's gatherers of each good gather from. */
export interface CollectorAnchors {
  /** The anchors of the good's first `count` posts, in rank order. */
  slotsOf(goodId: string, count: number): HalfCellNode[];
}

/** Each current holder's anchor, index for index, and the anchors left for new hires in rank order. */
export interface SeatedHolders {
  readonly anchors: readonly HalfCellNode[];
  readonly free: HalfCellNode[];
}

/**
 * Seat `holders` on `slots`: each, in canonical order, takes the free slot nearest its flag, the lowest
 * rank on a tie, so a hire or a loss never swaps the others across the map. A holder whose flag is gone
 * takes the lowest free rank. Holders beyond the slots gather beside `fallback`.
 */
export function seatHolders(
  world: World,
  holders: readonly Entity[],
  slots: readonly HalfCellNode[],
  fallback: HalfCellNode,
): SeatedHolders {
  const free = [...slots];
  const anchors = holders.map((holder) => {
    const flag = liveWorkFlag(world, holder);
    const at = flag === undefined ? null : anchorNodeOf(world, flag.flag);
    let pick = 0;
    for (let i = 1; at !== null && i < free.length; i++) {
      const slot = free[i];
      const best = free[pick];
      if (slot !== undefined && best !== undefined && nodeDistance(at, slot) < nodeDistance(at, best))
        pick = i;
    }
    return free.splice(pick, 1)[0] ?? fallback;
  });
  return { anchors, free };
}

function nodeDistance(a: HalfCellNode, b: HalfCellNode): number {
  return Math.abs(a.hx - b.hx) + Math.abs(a.hy - b.hy);
}

/** The decision's {@link CollectorAnchors} over the seat's `owned` buildings, sites included, since a
 *  placed workshop is where its goods will be wanted. A good with no workshop standing gathers beside
 *  `baseNode`. */
export function collectorAnchors(
  world: World,
  ctx: SystemContext,
  owned: readonly Entity[],
  baseNode: HalfCellNode,
): CollectorAnchors {
  const index = contentIndex(ctx.content);
  const workshops = new Map<string, HalfCellNode[]>();
  const workshopsOf = (buildingId: string): HalfCellNode[] => {
    const known = workshops.get(buildingId);
    if (known !== undefined) return known;
    const type = buildingTypeByContentId(ctx.content, buildingId);
    const chain = type === undefined ? new Set<number>() : tiersAtOrAbove(index, type);
    const nodes: HalfCellNode[] = [];
    for (const e of owned) {
      if (!chain.has(world.get(e, Building).buildingType)) continue;
      const node = anchorNodeOf(world, e);
      if (node !== null) nodes.push(node);
    }
    workshops.set(buildingId, nodes);
    return nodes;
  };
  const anchorOf = (goodId: string, rank: number): HalfCellNode => {
    const served = COLLECTOR_WORKSHOP_BY_GOOD_ID[goodId];
    if (served === undefined || rank >= (served.posts ?? Number.POSITIVE_INFINITY)) return baseNode;
    const nodes = workshopsOf(served.building);
    return nodes.length === 0 ? baseNode : (nodes[rank % nodes.length] ?? baseNode);
  };
  return {
    slotsOf: (goodId, count) => Array.from({ length: count }, (_, rank) => anchorOf(goodId, rank)),
  };
}
