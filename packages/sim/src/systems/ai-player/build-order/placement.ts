import { type BuildingType, footprintCellDx, footprintCellMaxAbsDx } from '@open-northland/data';
import { Building, diplomacyStance, Owner, ownerOf, Resource } from '../../../components/index.js';
import { type ContentIndex, contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import { withinNodeRadius } from '../../../nav/node-circle.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import { seatPlacementProbe } from '../../conflict/contested-ground.js';
import type { SystemContext } from '../../context.js';
import { ANCHOR_ONLY, buildingFootprintOf } from '../../footprint/geometry.js';
import { HEADQUARTERS_BUILDING_ID } from '../../readviews/index.js';
import { resourcesAtNode } from '../../spatial/resources.js';
import { goodTypeByContentId, tiersAtOrAbove } from '../content-lookup.js';
import { nearestLiveResource } from '../live-resources.js';
import type { EnemyFire } from '../military/defence/index.js';
import { anchorNodeOf, bestRingNode } from '../node-geometry.js';
import type { BuildOrderEntry, PlacementAffinity } from './entries.js';
import { BUILD_SEARCH_MAX_RADIUS_NODES } from './entries.js';

/** One affinity resolved to a node, or null when it cannot be. A `building` affinity takes the seat's
 *  lowest-id building of that id or a tier above it, so the pick is deterministic and an upgraded
 *  workshop still anchors; when the entry's `unlessWithin` names the same id, it takes the first such
 *  building with none of the entry's kind in reach, the one the placement exists to serve. */
function affinityNode(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  owned: readonly Entity[],
  anchor: HalfCellNode,
  type: BuildingType,
  entry: Extract<BuildOrderEntry, { kind: 'place' }>,
  affinity: PlacementAffinity,
): HalfCellNode | null {
  switch (affinity.kind) {
    case 'building': {
      const index = contentIndex(ctx.content);
      const near = entry.unlessWithin;
      const chosen =
        near !== undefined && near.building === affinity.id
          ? unservedAnchor(world, index, owned, tiersAtOrAbove(index, type), near)
          : anchorsOfId(world, index, owned, affinity.id)[0];
      return chosen === undefined || chosen === null ? null : anchorNodeOf(world, chosen);
    }
    case 'resource': {
      const good = goodTypeByContentId(ctx.content, affinity.good);
      if (good === undefined) return null;
      const resource = nearestLiveResource(world, good.typeId, anchor);
      return resource === null ? null : anchorNodeOf(world, resource);
    }
    case 'mapCentre':
      return mapCentreNode(terrain);
    case 'front':
      return frontNode(world, ctx, player, anchor) ?? mapCentreNode(terrain);
  }
}

/** The seat's buildings of the content id or a tier above it, canonical ascending; none for an unknown id. */
function anchorsOfId(world: World, index: ContentIndex, owned: readonly Entity[], id: string): Entity[] {
  const typeId = index.buildingTypeBySlug.get(id);
  const type = typeId === undefined ? undefined : index.buildings.get(typeId);
  if (type === undefined) return [];
  const chain = tiersAtOrAbove(index, type);
  return owned.filter((e) => chain.has(world.get(e, Building).buildingType));
}

/**
 * The seat's lowest-id `near.building` (or a tier above it) with no building of a `counted` type within
 * `near.radius` world-metric nodes, or null when every one has, or when the seat has none. The entry's
 * `unlessWithin` skip and its placement centre read the same pick, so the well it raises lands beside the
 * workshop that lacked one.
 */
export function unservedAnchor(
  world: World,
  index: ContentIndex,
  owned: readonly Entity[],
  counted: ReadonlySet<number>,
  near: { readonly building: string; readonly radius: number },
): Entity | null {
  const served: HalfCellNode[] = [];
  for (const e of owned) {
    if (!counted.has(world.get(e, Building).buildingType)) continue;
    const node = anchorNodeOf(world, e);
    if (node !== null) served.push(node);
  }
  for (const e of anchorsOfId(world, index, owned, near.building)) {
    const node = anchorNodeOf(world, e);
    if (node === null) continue;
    if (!served.some((s) => withinNodeRadius(node.hx, node.hy, s.hx, s.hy, near.radius))) return e;
  }
  return null;
}

function mapCentreNode(terrain: TerrainGraph): HalfCellNode {
  return { hx: Math.floor(terrain.width / 2), hy: Math.floor(terrain.height / 2) };
}

/**
 * The `front` anchor: the building nearest `anchor` (Manhattan) of a player the seat holds as enemy,
 * headquarters ranked ahead of everything else, so the pull points down the road the attacks come by
 * rather than at the middle of the map. Null while no enemy has a building. Strict `<` over the
 * canonical walk keeps the lowest id on ties.
 */
function frontNode(
  world: World,
  ctx: SystemContext,
  player: number,
  anchor: HalfCellNode,
): HalfCellNode | null {
  const index = contentIndex(ctx.content);
  let best: HalfCellNode | null = null;
  let bestHq = false;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const e of world.canonicalQuery(Building, Owner)) {
    const owner = ownerOf(world, e);
    if (owner === undefined || owner === player || diplomacyStance(world, player, owner) !== 'enemy')
      continue;
    const node = anchorNodeOf(world, e);
    if (node === null) continue;
    const hq = index.buildings.get(world.get(e, Building).buildingType)?.id === HEADQUARTERS_BUILDING_ID;
    if (bestHq && !hq) continue;
    const distance = nodeDistance(node, anchor);
    if ((hq && !bestHq) || distance < bestDistance) {
      best = node;
      bestHq = hq;
      bestDistance = distance;
    }
  }
  return best;
}

/** Lattice Manhattan distance, not the anisotropic world metric the spacing veto measures in. */
function nodeDistance(a: HalfCellNode, b: HalfCellNode): number {
  return Math.abs(a.hx - b.hx) + Math.abs(a.hy - b.hy);
}

/** The centre the ring search grows from: the integer mean of the entry's resolved affinity nodes,
 *  clamped back into the seat's {@link BuildReach}, or the anchor itself when nothing resolves. `serves` is
 *  the building an `unlessWithin` entry's affinity picked, which the spot must land in reach of, else null. */
function searchCentre(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  owned: readonly Entity[],
  anchor: HalfCellNode,
  reach: BuildReach,
  type: BuildingType,
  entry: Extract<BuildOrderEntry, { kind: 'place' }>,
): { centre: HalfCellNode; serves: HalfCellNode | null } {
  const anchors: HalfCellNode[] = [];
  let serves: HalfCellNode | null = null;
  for (const affinity of entry.near ?? []) {
    const node = affinityNode(world, ctx, terrain, player, owned, anchor, type, entry, affinity);
    if (node === null) continue;
    anchors.push(node);
    if (affinity.kind === 'building' && affinity.id === entry.unlessWithin?.building) serves = node;
  }
  if (anchors.length === 0) return { centre: anchor, serves };
  let sx = 0;
  let sy = 0;
  for (const a of anchors) {
    sx += a.hx;
    sy += a.hy;
  }
  return {
    centre: reach.clamp({ hx: Math.floor(sx / anchors.length), hy: Math.floor(sy / anchors.length) }),
    serves,
  };
}

/** The ground a placement may take: within {@link BUILD_SEARCH_MAX_RADIUS_NODES} (Manhattan) of one of
 *  the seat's buildings, sites included, so the settlement keeps growing from wherever it stands. */
export interface BuildReach {
  contains(x: number, y: number): boolean;
  /** `node` itself when inside, else pulled onto the disc edge of the building nearest it. */
  clamp(node: HalfCellNode): HalfCellNode;
  /** The same reach cut to the buildings whose discs meet the Manhattan disc of `span` around `centre`,
   *  for a search that never leaves that disc. */
  around(centre: HalfCellNode, span: number): BuildReach;
}

/** The {@link BuildReach} of the seat's `owned` buildings, or of `fallback` alone while none has a node. */
export function buildReach(world: World, owned: readonly Entity[], fallback: HalfCellNode): BuildReach {
  const centres: HalfCellNode[] = [];
  for (const e of owned) {
    const node = anchorNodeOf(world, e);
    if (node !== null) centres.push(node);
  }
  if (centres.length === 0) centres.push(fallback);
  return reachOver(centres, fallback);
}

function reachOver(centres: readonly HalfCellNode[], fallback: HalfCellNode): BuildReach {
  const radius = BUILD_SEARCH_MAX_RADIUS_NODES;
  // Ring walks test runs of nearby nodes, so the centre that took the last one goes first.
  let last = 0;
  const within = (c: HalfCellNode | undefined, x: number, y: number): boolean =>
    c !== undefined && Math.abs(x - c.hx) + Math.abs(y - c.hy) <= radius;
  return {
    contains(x, y) {
      if (within(centres[last], x, y)) return true;
      for (let i = 0; i < centres.length; i++) {
        if (!within(centres[i], x, y)) continue;
        last = i;
        return true;
      }
      return false;
    },
    around(centre, span) {
      return reachOver(
        centres.filter((c) => nodeDistance(c, centre) <= span + radius),
        fallback,
      );
    },
    clamp(node) {
      let nearest = centres[0] ?? fallback;
      for (const c of centres) if (nodeDistance(node, c) < nodeDistance(node, nearest)) nearest = c;
      const dx = node.hx - nearest.hx;
      const dy = node.hy - nearest.hy;
      const dist = Math.abs(dx) + Math.abs(dy);
      if (dist <= radius) return node;
      // Integer projection toward the building; trunc keeps |dx'|+|dy'| ≤ the radius. Plain `/` on integer
      // operands is exactly rounded, so the result is byte-identical across engines.
      return {
        hx: nearest.hx + Math.trunc((dx * radius) / dist),
        hy: nearest.hy + Math.trunc((dy * radius) / dist),
      };
    },
  };
}

/** Every reserved footprint cell must be sowable ground. Approximation: "the farm stands on grass" is
 *  encoded as the reserved zone on `plantable` terrain (the original's `biocanplanton` class); the
 *  surrounding field ring is not pre-checked, since sowing already skips barren nodes. */
function groundAccepted(
  ctx: SystemContext,
  terrain: TerrainGraph,
  type: BuildingType,
  entry: Extract<BuildOrderEntry, { kind: 'place' }>,
  x: number,
  y: number,
): boolean {
  if (entry.ground === undefined) return true;
  const footprint = buildingFootprintOf(ctx.content, type.typeId);
  if (footprint === undefined) return terrain.isPlantable(terrain.nodeAt(x, y));
  for (const c of footprint.reserved) {
    const cx = x + footprintCellDx(y, c);
    const cy = y + c.dy;
    if (!terrain.inBounds(cx, cy) || !terrain.isPlantable(terrain.nodeAt(cx, cy))) return false;
  }
  return true;
}

/** The deposits a workshop's gatherers dig, which a seat building never covers (authored). The engine's
 *  blockers already keep a zone off every walk body, so this adds only the walk-free deposits; mushrooms,
 *  herbs, trunks and carcasses stay coverable. */
const DEPOSIT_GOOD_IDS: readonly string[] = ['mud', 'stone', 'iron', 'gold'];

/** How far out from its anchor a building of the type's chain ever has a wall, in Manhattan nodes: what an
 *  enemy shot at the building reaches for. */
function wallSpan(ctx: SystemContext, buildingTypeId: number): number {
  const footprint = buildingFootprintOf(ctx.content, buildingTypeId);
  let span = 0;
  for (const c of [...(footprint?.familyBody ?? []), ...(footprint?.blocked ?? [])]) {
    span = Math.max(span, footprintCellMaxAbsDx(c) + Math.abs(c.dy));
  }
  return span;
}

/**
 * Shared legality test for a spot search: in-bounds buildable ground, off every existing building's
 * anchor (explicit, so a footprint-less synthetic type never stacks), out of every enemy fighter's reach
 * (`underFire`, judged at the walls and narrowed once to the shooters the `fan` around `centre` can meet),
 * accepted by the seat's placement probe, and with its reserved zone
 * off every live {@link DEPOSIT_GOOD_IDS} deposit's own node. The engine lets a building cover a deposit
 * that carries no walk or build block, such as clay, and so bury it; the seat never does. It scans the
 * occupied set once per call, so build the closure per search, not per candidate.
 */
export function buildingSpotAccept(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  buildingTypeId: number,
  underFire: EnemyFire,
  centre: HalfCellNode,
  fan: number,
): (x: number, y: number) => boolean {
  const span = wallSpan(ctx, buildingTypeId);
  const fire = underFire.around(centre.hx, centre.hy, fan, span);
  const occupied = new Set<NodeId>(); // an off-grid anchor can never match a candidate, so it is left out
  for (const e of world.query(Building)) {
    const node = anchorNodeOf(world, e);
    if (node !== null && terrain.inBounds(node.hx, node.hy)) occupied.add(terrain.nodeAt(node.hx, node.hy));
  }
  const probe = seatPlacementProbe(world, ctx.content, terrain, ctx.fog, buildingTypeId, player);
  const reserved = buildingFootprintOf(ctx.content, buildingTypeId)?.reserved;
  const zone = reserved !== undefined && reserved.length > 0 ? reserved : ANCHOR_ONLY;
  const deposits = new Set<number>();
  for (const id of DEPOSIT_GOOD_IDS) {
    const good = goodTypeByContentId(ctx.content, id);
    if (good !== undefined) deposits.add(good.typeId);
  }
  return (x, y) => {
    if (!terrain.inBounds(x, y)) return false;
    const node = terrain.nodeAt(x, y);
    if (!terrain.isBuildable(node) || occupied.has(node) || fire.reaches(x, y, span)) return false;
    return probe.canPlace(x, y) && !coversLiveDeposit(world, deposits, zone, x, y);
  };
}

/** Whether the zone `cells` anchored at `(x, y)` covers the node of a `deposits` resource with goods left. */
function coversLiveDeposit(
  world: World,
  deposits: ReadonlySet<number>,
  cells: readonly { dx: number; dy: number }[],
  x: number,
  y: number,
): boolean {
  if (deposits.size === 0) return false;
  for (const c of cells) {
    for (const e of resourcesAtNode(world, x + footprintCellDx(y, c), y + c.dy)) {
      const r = world.get(e, Resource);
      if (r.remaining > 0 && deposits.has(r.goodType)) return true;
    }
  }
  return false;
}

/** How many nodes of Manhattan distance from the base anchor cost a candidate spot one ring of distance
 *  from the {@link searchCentre} (authored): the affinity centre stays the main criterion and the base's
 *  closeness decides between spots about as near to it, so a settlement grows round rather than long. */
export const HQ_PULL_DIVISOR_NODES = 4;

/**
 * The legal node inside the seat's {@link BuildReach} of least ring radius from {@link searchCentre} plus
 * the {@link HQ_PULL_DIVISOR_NODES} pull toward `anchor`, or null to stall the entry. The ring budget is
 * twice the reach radius, so a centre inside one building's disc reaches every node of that disc. An
 * `unlessWithin` entry's spot must lie within that radius of the building it serves, or a well would go
 * up that serves nothing.
 *
 * An affinity pull that finds nothing yields to the same search from `anchor` (owner's rule): a
 * settlement wider than the fan keeps room on its far side that the pulled centre never reaches, and a
 * barracks or a mint anywhere in it beats a list stalled for half an hour.
 */
export function placementSpot(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  owned: readonly Entity[],
  anchor: HalfCellNode,
  type: BuildingType,
  entry: Extract<BuildOrderEntry, { kind: 'place' }>,
  underFire: EnemyFire,
): HalfCellNode | null {
  const settlement = buildReach(world, owned, anchor);
  const { centre, serves } = searchCentre(
    world,
    ctx,
    terrain,
    player,
    owned,
    anchor,
    settlement,
    type,
    entry,
  );
  const pulled = spotAround(
    world,
    ctx,
    terrain,
    player,
    settlement,
    anchor,
    centre,
    serves,
    type,
    entry,
    underFire,
  );
  if (pulled !== null || (centre.hx === anchor.hx && centre.hy === anchor.hy)) return pulled;
  return spotAround(world, ctx, terrain, player, settlement, anchor, anchor, serves, type, entry, underFire);
}

function spotAround(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  settlement: BuildReach,
  anchor: HalfCellNode,
  centre: HalfCellNode,
  serves: HalfCellNode | null,
  type: BuildingType,
  entry: Extract<BuildOrderEntry, { kind: 'place' }>,
  underFire: EnemyFire,
): HalfCellNode | null {
  const fan = 2 * BUILD_SEARCH_MAX_RADIUS_NODES;
  const accept = buildingSpotAccept(world, ctx, terrain, player, type.typeId, underFire, centre, fan);
  const reach = settlement.around(centre, fan);
  const serveRadius = entry.unlessWithin?.radius ?? 0;
  const hqPull = (x: number, y: number): number =>
    Math.floor((Math.abs(x - anchor.hx) + Math.abs(y - anchor.hy)) / HQ_PULL_DIVISOR_NODES);
  return bestRingNode(centre.hx, centre.hy, fan, hqPull, (x, y) => {
    // The reach first: an affinity-pulled centre puts much of every ring outside it, and a stalled
    // entry re-walks the whole fan on every retry.
    if (!reach.contains(x, y)) return false;
    if (serves !== null && !withinNodeRadius(serves.hx, serves.hy, x, y, serveRadius)) return false;
    if (!terrain.inBounds(x, y)) return false; // groundAccepted resolves nodes - bounds come first
    if (!groundAccepted(ctx, terrain, type, entry, x, y)) return false;
    return accept(x, y);
  });
}
