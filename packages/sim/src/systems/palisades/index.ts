import { type FootprintCell, footprintCellDx } from '@open-northland/data';
import {
  Damaged,
  Health,
  Owner,
  ownerOf,
  Palisade,
  PalisadeBlocking,
  Position,
  Settler,
  Stockpile,
  stampOwner,
  UnderConstruction,
} from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import { fx, ONE } from '../../core/fixed.js';
import type { ChangeFeed, Entity, World } from '../../ecs/world.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import { nodeOfPosition, positionOfNode } from '../../nav/halfcell.js';
import type { NodeId, ScriptLandscapeType, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { evictLooseGoodsFromCells } from '../economy/goods-evict.js';
import { markShortPool } from '../economy/repair.js';
import { evictWorkFlagsFromCells } from '../economy/work-flag.js';
import { buildingOpenings } from '../footprint/building-blocked-cache.js';
import { translatedCells } from '../footprint/geometry.js';
import { dynamicBlockOverlay } from '../footprint/index.js';
import { placementBlockerGrid } from '../footprint/placement/blocker-grid.js';
import { canPlacePalisadeAnchor, type PlacementProbe } from '../footprint/placement/index.js';
import { wallClosingCells } from '../footprint/wall-joints.js';
import { anyRouteFollowed, invalidateRoutesThrough } from '../landscape/routes.js';
import { landscapeTypes } from '../landscape/view.js';
import { evictSettlersFromCells } from '../movement/evict.js';
import { isTravelling } from '../movement/nav-state.js';
import { canonicalById, NodeBuckets } from '../spatial/nodes.js';

export type PalisadeGateAxis = 0 | 1 | 2;

export interface PalisadeGateProbeResult {
  readonly canConvert: boolean;
  /** The gate row this result speaks for; null when no offered row suits the hovered node. */
  readonly gfxIndex: number | null;
  readonly center: Entity | null;
  readonly axis: PalisadeGateAxis | null;
  /** The span's two neighbours of the centre, which the gate entity absorbs. */
  readonly remove: readonly Entity[];
  /** All five walls of a convertible span, centre included; empty when the conversion is refused. */
  readonly walls: readonly Entity[];
  /** The five nodes at offsets -2..2 along the gate axis, so the centre is the middle one. */
  readonly span: readonly { hx: number; hy: number }[];
}

export function palisadeType(terrain: TerrainGraph, gfxIndex: number): ScriptLandscapeType | undefined {
  const type = landscapeTypes(terrain).get(gfxIndex);
  return type?.wall === undefined ? undefined : type;
}

function placementWalkOf(terrain: TerrainGraph, type: ScriptLandscapeType): readonly FootprintCell[] {
  const gate = type.wall?.gate;
  if (gate?.open !== true) return type.walk;
  const closed = palisadeType(terrain, gate.counterpartGfxIndex);
  return closed?.wall?.gate?.open === false ? closed.walk : type.walk;
}

/** A reusable placement query shared by the UI ghost and command application. */
export function palisadePlacementProbe(
  world: World,
  content: SystemContext['content'],
  terrain: TerrainGraph,
  gfxIndex: number,
): PlacementProbe | null {
  const type = palisadeType(terrain, gfxIndex);
  if (type === undefined) return null;
  const body = placementWalkOf(terrain, type);
  const grid = placementBlockerGrid(world, content, terrain);
  return { canPlace: (x, y) => canPlacePalisadeAnchor(grid, body, x, y) };
}

/** Assemble a wall segment from one validated map-catalog row. Used by the command and authored map boot. */
export function createPalisade(
  world: World,
  type: ScriptLandscapeType,
  spec: {
    readonly x: number;
    readonly y: number;
    readonly tribe: number;
    readonly owner?: number;
    readonly underConstruction: boolean;
    readonly valency?: number;
    readonly placementWalk?: readonly FootprintCell[];
  },
): Entity | null {
  const wall = type.wall;
  if (wall === undefined || wall.maxHitpoints <= 0 || wall.repairPerStrike <= 0) return null;
  const hitpoints = spec.underConstruction
    ? 1
    : Math.min(wall.maxHitpoints, Math.max(1, spec.valency ?? wall.maxHitpoints));
  const e = world.create();
  world.add(e, Position, positionOfNode(spec.x, spec.y));
  world.add(e, Palisade, {
    gfxIndex: type.typeId,
    tribe: spec.tribe,
    built: spec.underConstruction ? fx.fromInt(0) : ONE,
    walk: type.walk.map((cell) => ({ ...cell })),
    placementWalk: (spec.placementWalk ?? type.walk).map((cell) => ({ ...cell })),
    construction: wall.construction.map((line) => ({ ...line })),
    repairPerStrike: wall.repairPerStrike,
    reservation: null,
    gate: wall.gate === undefined ? null : { ...wall.gate },
  });
  world.add(e, Health, {
    hitpoints,
    max: wall.maxHitpoints,
  });
  world.add(e, Stockpile, { amounts: new Map<number, number>() });
  if (spec.underConstruction) world.add(e, UnderConstruction, { labor: fx.fromInt(0) });
  else world.add(e, PalisadeBlocking, {});
  stampOwner(world, e, spec.owner);
  return e;
}

/** Open or close a standing gate, a damaged one included, by swapping to its paired data row, reporting whether the swap landed.
 * Closing is refused while a settler or creature stands on a cell the closed gate would block, its joint
 * seals included; a gate already in the requested state counts as landed. */
export function setPalisadeGate(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'setPalisadeGate' }>,
): boolean {
  const terrain = ctx.terrain;
  const current = world.tryGet(command.palisade, Palisade);
  if (
    terrain === undefined ||
    current === undefined ||
    current.gate === null ||
    !palisadeStands(world, command.palisade)
  )
    return false;
  if (current.gate.open === command.open) return true;
  const target = palisadeType(terrain, current.gate.counterpartGfxIndex);
  if (target?.wall?.gate === undefined || target.wall.gate.open !== command.open) return false;
  if (!command.open && gateClosingOccupied(world, ctx, terrain, command.palisade, target.walk)) return false;

  // Remove + add so footprint journals see the source-record swap as a topology change.
  const blocking = world.has(command.palisade, PalisadeBlocking);
  if (blocking) world.remove(command.palisade, PalisadeBlocking);
  world.remove(command.palisade, Palisade);
  world.add(command.palisade, Palisade, {
    gfxIndex: target.typeId,
    tribe: current.tribe,
    built: current.built,
    walk: target.walk.map((cell) => ({ ...cell })),
    placementWalk: current.placementWalk.map((cell) => ({ ...cell })),
    construction: target.wall.construction.map((line) => ({ ...line })),
    repairPerStrike: target.wall.repairPerStrike,
    reservation: current.reservation === null ? null : { ...current.reservation },
    gate: { ...target.wall.gate },
  });
  const health = world.tryMut(command.palisade, Health);
  if (health !== undefined && health.max !== target.wall.maxHitpoints) {
    health.hitpoints = Math.min(health.hitpoints, target.wall.maxHitpoints);
    health.max = target.wall.maxHitpoints;
  }
  if (blocking) world.add(command.palisade, PalisadeBlocking, {});
  if (blocking && !command.open) settleClosedWall(world, ctx, terrain, command.palisade);
  return true;
}

/** The cells wall or gate `e` closes with `walk`, its joint seals included. */
function closingCellsOf(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  walk: readonly FootprintCell[],
): Set<NodeId> {
  const at = world.get(e, Position);
  const { hx, hy } = nodeOfPosition(at.x, at.y);
  return wallClosingCells(world, terrain, walk, hx, hy, buildingOpenings(world, ctx.content, terrain));
}

/**
 * Settle the ground a wall that just started blocking closed, its body and its joint seals: every walker
 * whose route runs through it stops and searches again, rather than stepping through a gate that shut in
 * front of it, and the settlers standing idle there, the loose goods and the work flags are pushed off,
 * so none is stranded on a node no route leaves. A traveller stays; a wall site waits for it.
 */
export function settleClosedWall(world: World, ctx: SystemContext, terrain: TerrainGraph, e: Entity): void {
  const closing = closingCellsOf(world, ctx, terrain, e, world.get(e, Palisade).walk);
  // A map's authored walls stand before anyone walks, so its load skips the route scan.
  if (anyRouteFollowed(world)) invalidateRoutesThrough(world, terrain, closing);
  evictSettlersFromCells(world, ctx, terrain, closing);
  evictLooseGoodsFromCells(world, ctx, terrain, closing);
  // Built only when a flag is enclosed: a map's load places every wall before any flag stands.
  let blocked: BlockOverlay | null = null;
  evictWorkFlagsFromCells(world, ctx, terrain, closing, (node) => {
    blocked ??= dynamicBlockOverlay(world, ctx, terrain);
    return !blocked.has(node);
  });
}

/** The settlers standing on each node, filled on first use, so a construction pass pays one settler scan
 *  however many wall sites wait on it. An eviction moves only idle settlers, never a traveller, which is
 *  all this reads. */
export class WallSiteOccupancy {
  private byNode: NodeBuckets | null = null;

  constructor(
    private readonly world: World,
    private readonly ctx: SystemContext,
  ) {}

  /** Whether a traveller stands where wall site `e` would close, which the finish waits out. */
  travellerOnClosing(terrain: TerrainGraph, e: Entity): boolean {
    const world = this.world;
    this.byNode ??= new NodeBuckets(world, world.query(Settler, Position));
    for (const cell of closingCellsOf(world, this.ctx, terrain, e, world.get(e, Palisade).walk)) {
      for (const settler of this.byNode.at(terrain.xOf(cell), terrain.yOf(cell))) {
        if (isTravelling(world, settler)) return true;
      }
    }
    return false;
  }
}

/** The completed gate of `player` standing on `hx,hy` - the anchor itself or any node its closed body
 *  blocks, so a script may name any point along the gate. */
export function playerGateAt(
  world: World,
  terrain: TerrainGraph,
  player: number,
  hx: number,
  hy: number,
): Entity | null {
  const node = terrain.nodeAtClamped(hx, hy);
  for (const e of world.query(Palisade, Position)) {
    const wall = world.get(e, Palisade);
    if (wall.gate === null || !palisadeStands(world, e) || ownerOf(world, e) !== player) continue;
    const at = world.get(e, Position);
    const anchor = nodeOfPosition(at.x, at.y);
    if (terrain.nodeAtClamped(anchor.hx, anchor.hy) === node) return e;
    if (translatedCells(terrain, wall.placementWalk, anchor.hx, anchor.hy).includes(node)) return e;
  }
  return null;
}

/** Whether a settler or creature stands on one of `cells`. Only movers count: dropped goods and the wall
 *  posts a gate's body overlaps are not something a door can crush. */
function moverOnCells(world: World, terrain: TerrainGraph, cells: ReadonlySet<NodeId>): boolean {
  for (const e of world.query(Settler, Position)) {
    const p = world.get(e, Position);
    const here = nodeOfPosition(p.x, p.y);
    if (cells.has(terrain.nodeAtClamped(here.hx, here.hy))) return true;
  }
  return false;
}

/**
 * Whether a mover stands where the gate's `walk` footprint, or a joint seal it makes, would close.
 *
 * Approximation: the original swaps the gate record with no occupancy test at all, so it closes on a
 * passer-by. Refusing is this build's adaptation.
 */
function gateClosingOccupied(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  gate: Entity,
  walk: readonly FootprintCell[],
): boolean {
  return moverOnCells(world, terrain, closingCellsOf(world, ctx, terrain, gate, walk));
}

interface AxialNode {
  readonly q: number;
  readonly r: number;
}

function axialOf(hx: number, hy: number): AxialNode {
  return { q: hx - (hy - (hy & 1)) / 2, r: hy };
}

function offsetOf(q: number, r: number): { hx: number; hy: number } {
  return { hx: q + (r - (r & 1)) / 2, hy: r };
}

function axisNode(center: AxialNode, axis: PalisadeGateAxis, offset: number): { hx: number; hy: number } {
  if (axis === 0) return offsetOf(center.q + offset, center.r);
  if (axis === 1) return offsetOf(center.q, center.r + offset);
  return offsetOf(center.q + offset, center.r - offset);
}

/** Infer the gate's wall axis from its authored closed collision cells. */
function gateAxis(type: ScriptLandscapeType): PalisadeGateAxis | null {
  if (type.wall?.gate?.open !== false || type.walk.length < 2) return null;
  const points = type.walk.map((cell) => axialOf(footprintCellDx(0, cell), cell.dy));
  if (points.every((point) => point.r === points[0]?.r)) return 0;
  if (points.every((point) => point.q === points[0]?.q)) return 1;
  if (points.every((point) => point.q + point.r === (points[0]?.q ?? 0) + (points[0]?.r ?? 0))) return 2;
  return null;
}

/** Canonical order, so two walls forced onto one node pick the same member in a live and a restored world. */
function palisadesByNode(world: World): NodeBuckets {
  return new NodeBuckets(world, canonicalById(world.query(Palisade, Position)));
}

function wallAt(byNode: NodeBuckets, world: World, hx: number, hy: number): Entity | null {
  for (const e of byNode.at(hx, hy)) {
    if (world.get(e, Palisade).gate === null) return e;
  }
  return null;
}

function hasStoredGoods(world: World, e: Entity): boolean {
  const stock = world.tryGet(e, Stockpile);
  if (stock === undefined) return false;
  for (const amount of stock.amounts.values()) if (amount > 0) return true;
  return false;
}

/**
 * Authoritative five-wall conversion query used by both the UI preview and command application.
 *
 * Original behavior: the hovered point and the four nodes two steps either way along one hex direction
 * must all be the player's own wall record, each at three quarters of its maximum valency or better,
 * and within 8 height units of the centre. The original tries the three gate directions in turn; each
 * authored gate row carries one of them, so the held row picks the axis here instead.
 *
 * Omitted: the original then walks the two lines flanking the run and refuses a blocked one, so it also
 * demands open ground alongside - a gate must lead somewhere. This build tests only the gate's own body
 * for a mover, which admits spans the original would refuse.
 */
export function palisadeGateProbe(
  world: World,
  terrain: TerrainGraph,
  hx: number,
  hy: number,
  gfxIndexes: readonly number[],
  player?: number,
): PalisadeGateProbeResult {
  // The node index is the walk this query pays for, so the offered rows share one build: the caller
  // hands over every authored orientation and the first that suits the hovered run wins.
  const byNode = palisadesByNode(world);
  let fallback: PalisadeGateProbeResult | null = null;
  for (const gfxIndex of gfxIndexes) {
    const result = probeGateRow(world, terrain, byNode, hx, hy, gfxIndex, player);
    if (result.canConvert) return result;
    if (fallback === null || (fallback.span.length === 0 && result.span.length > 0)) fallback = result;
  }
  return fallback ?? NO_GATE_PROBE;
}

/**
 * Every wall of `player` a gate can go into: the convertible probe of each own finished segment as a
 * centre, over the same rows {@link palisadeGateProbe} offers. One node index serves the whole scan. The
 * mover in the opening is left to the live probe, since it changes every tick and costs a settler scan
 * per centre.
 */
export function palisadeGateSites(
  world: World,
  terrain: TerrainGraph,
  gfxIndexes: readonly number[],
  player: number,
): PalisadeGateProbeResult[] {
  const byNode = palisadesByNode(world);
  const sites: PalisadeGateProbeResult[] = [];
  for (const e of canonicalById(world.query(Palisade, Position))) {
    if (ownerOf(world, e) !== player || world.get(e, Palisade).gate !== null) continue;
    if (!palisadeStands(world, e)) continue;
    const p = world.get(e, Position);
    const node = nodeOfPosition(p.x, p.y);
    for (const gfxIndex of gfxIndexes) {
      const result = probeGateRow(world, terrain, byNode, node.hx, node.hy, gfxIndex, player, false);
      if (result.canConvert) {
        sites.push(result);
        break;
      }
    }
  }
  return sites;
}

/** The per-wall inputs of {@link palisadeGateSites} besides the wall set: construction, owner, health and
 *  the stock a gate's cleared neighbours may not hold. */
const GATE_SITE_MEMBERSHIP = [UnderConstruction, Owner, Health, Stockpile];
const GATE_SITE_VALUES = [Owner, Health, Stockpile];

interface GateSiteWatch {
  readonly feed: ChangeFeed;
  /** Bumped by every drained write that lands on a wall. */
  revision: number;
}

const gateSiteWatches = new WeakMap<World, GateSiteWatch>();

/**
 * A token over the inputs of {@link palisadeGateSites} other than movers. The Palisade membership
 * generation carries the wall set and every gate swap; a change feed catches the per-wall inputs, so a
 * settler's heal or a house's stock leaves it alone. Never hashed.
 */
export function palisadeLayoutVersion(world: World): string {
  let watch = gateSiteWatches.get(world);
  if (watch === undefined) {
    watch = { feed: world.watchChanges(GATE_SITE_MEMBERSHIP, GATE_SITE_VALUES), revision: 0 };
    gateSiteWatches.set(world, watch);
  }
  let wallChanged = false;
  const lost = watch.feed.drain((e) => {
    if (!wallChanged && world.has(e, Palisade)) wallChanged = true;
  });
  if (lost || wallChanged) watch.revision++;
  return `${world.componentGeneration(Palisade)}.${watch.revision}`;
}

/** The nodes `player`'s walls, gates and wall sites stand on, which a new wall line may join. */
export function ownPalisadeNodes(world: World, player: number): (hx: number, hy: number) => boolean {
  const byNode = palisadesByNode(world);
  return (hx, hy) => byNode.at(hx, hy).some((e) => ownerOf(world, e) === player);
}

const NO_GATE_PROBE: PalisadeGateProbeResult = {
  canConvert: false,
  gfxIndex: null,
  center: null,
  axis: null,
  remove: [],
  walls: [],
  span: [],
};

function probeGateRow(
  world: World,
  terrain: TerrainGraph,
  byNode: NodeBuckets,
  hx: number,
  hy: number,
  gfxIndex: number,
  player?: number,
  checkMovers = true,
): PalisadeGateProbeResult {
  const type = palisadeType(terrain, gfxIndex);
  const axis = type === undefined ? null : gateAxis(type);
  const empty = { canConvert: false, gfxIndex, center: null, axis, remove: [], walls: [], span: [] } as const;
  if (type?.wall?.gate?.open !== false || axis === null) return empty;
  const center = wallAt(byNode, world, hx, hy);
  const axial = axialOf(hx, hy);
  const span = [-2, -1, 0, 1, 2].map((offset) => axisNode(axial, axis, offset));
  if (center === null) return { ...empty, span };
  const centerWall = world.get(center, Palisade);
  const owner = ownerOf(world, center);
  if (player !== undefined && owner !== player) return { ...empty, center, span };
  const walls: Entity[] = [];
  const centerElevation = terrain.elevationAt(hx, hy);
  for (const node of span) {
    const e = wallAt(byNode, world, node.hx, node.hy);
    if (e === null) return { ...empty, center, span };
    const wall = world.get(e, Palisade);
    const health = world.tryGet(e, Health);
    if (
      !palisadeStands(world, e) ||
      wall.tribe !== centerWall.tribe ||
      ownerOf(world, e) !== owner ||
      health === undefined ||
      health.hitpoints * 4 < health.max * 3 ||
      Math.abs(terrain.elevationAt(node.hx, node.hy) - centerElevation) > 8
    ) {
      return { ...empty, center, span };
    }
    walls.push(e);
  }
  // The source clears the two neighbours and stamps the gate on the centre; the span's outer posts stay
  // standing inside the gate's own body, which is why collision reads nodes rather than entities.
  const remove = [walls[1], walls[3]].filter((e): e is Entity => e !== undefined);
  if (remove.some((e) => hasStoredGoods(world, e))) return { ...empty, center, span };
  const at = world.get(center, Position);
  const anchor = nodeOfPosition(at.x, at.y);
  if (
    checkMovers &&
    moverOnCells(world, terrain, new Set(translatedCells(terrain, type.walk, anchor.hx, anchor.hy)))
  ) {
    return { ...empty, center, span };
  }
  return { canConvert: true, gfxIndex, center, axis, remove, walls, span };
}

/** Install a completed closed gate on the centre of a qualifying five-wall run, clearing its two
 * neighbours. The outer pair stays, exactly as the original leaves it. */
export function convertPalisadeGate(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'convertPalisadeGate' }>,
): void {
  const terrain = ctx.terrain;
  const p = world.tryGet(command.palisade, Position);
  if (terrain === undefined || p === undefined) return;
  const node = nodeOfPosition(p.x, p.y);
  const probe = palisadeGateProbe(
    world,
    terrain,
    node.hx,
    node.hy,
    [command.gfxIndex],
    ownerOf(world, command.palisade),
  );
  if (!probe.canConvert || probe.center !== command.palisade) return;
  // Every guard runs before the span is torn down, so a rejected conversion never leaves a gap.
  const type = palisadeType(terrain, command.gfxIndex);
  const wall = type?.wall;
  if (type === undefined || wall?.gate?.open !== false) return;
  const centerWall = world.get(command.palisade, Palisade);
  for (const e of probe.remove) world.destroy(e);
  // A damaged centre becomes a whole new gate.
  world.remove(command.palisade, Damaged);
  world.remove(command.palisade, PalisadeBlocking);
  world.remove(command.palisade, Palisade);
  world.add(command.palisade, Palisade, {
    gfxIndex: type.typeId,
    tribe: centerWall.tribe,
    built: fx.fromInt(1),
    walk: type.walk.map((cell) => ({ ...cell })),
    placementWalk: placementWalkOf(terrain, type).map((cell) => ({ ...cell })),
    construction: wall.construction.map((line) => ({ ...line })),
    repairPerStrike: wall.repairPerStrike,
    reservation: null,
    gate: { ...wall.gate },
  });
  world.add(command.palisade, Health, { hitpoints: wall.maxHitpoints, max: wall.maxHitpoints });
  world.add(command.palisade, PalisadeBlocking, {});
  settleClosedWall(world, ctx, terrain, command.palisade);
}

/** A standing wall or gate, damaged or whole, rather than a segment still to be raised. */
function palisadeStands(world: World, e: Entity): boolean {
  return !world.has(e, UnderConstruction);
}

export function placePalisade(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'placePalisade' }>,
): void {
  const terrain = ctx.terrain;
  if (terrain === undefined) return;
  const type = palisadeType(terrain, command.gfxIndex);
  if (type === undefined) return;
  if (command.force !== true) {
    const probe = palisadePlacementProbe(world, ctx.content, terrain, command.gfxIndex);
    if (probe === null || !probe.canPlace(command.x, command.y)) return;
  }
  const entity = createPalisade(world, type, {
    x: command.x,
    y: command.y,
    tribe: command.tribe,
    ...(command.owner !== undefined ? { owner: command.owner } : {}),
    underConstruction: command.underConstruction === true,
    ...(command.valency !== undefined ? { valency: command.valency } : {}),
    placementWalk: placementWalkOf(terrain, type),
  });
  if (entity === null) return;
  if (world.has(entity, PalisadeBlocking)) {
    settleClosedWall(world, ctx, terrain, entity);
    // An authored wall below its maximum starts on the builders' list with no blow behind it; a new
    // segment's pool climbs with its build instead.
    markShortPool(world, entity);
  }
}
