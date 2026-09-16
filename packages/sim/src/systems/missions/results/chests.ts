import { type HalfCellNode, hexagonRing, hexNeighboursOf } from '../../../nav/halfcell.js';
import type { NodeId, ScriptLandscapeType, TerrainGraph } from '../../../nav/terrain/index.js';
import { dynamicBlockOverlay } from '../../footprint/index.js';
import { setLandscape } from '../../landscape/edits.js';
import { invalidateLandscapeRoutes } from '../../landscape/routes.js';
import type { MissionPass } from '../pass.js';
import type { MissionResultOp } from '../script.js';

/** `TMapChestRandomType` bit order and the half-open chest-type spans selected by the original. */
const RANDOM_CHEST_GROUPS = [
  { bit: 1, first: 94, end: 96 }, // soldiers
  { bit: 2, first: 52, end: 53 }, // tower
  { bit: 4, first: 91, end: 92 }, // catapult
  { bit: 8, first: 20, end: 21 }, // goods
  { bit: 16, first: 51, end: 73 }, // buildings and papers
  { bit: 32, first: 0, end: 1 }, // empty/invalid: the original places nothing when selected
  { bit: 64, first: 1, end: 7 }, // potions
  { bit: 128, first: 7, end: 13 }, // amulets
  { bit: 256, first: 90, end: 91 }, // wolves
  { bit: 512, first: 24, end: 26 }, // armour
  { bit: 1024, first: 96, end: 97 }, // lions
] as const;

const NEARBY_SEARCH_RADIUS = 9;
const RANDOM_POSITION_ATTEMPTS = 6;

type RandomChestDraw =
  | { readonly kind: 'contents'; readonly contents: number }
  | { readonly kind: 'empty' }
  | { readonly kind: 'invalid' };

/** Draw the chest category, then its contents, consuming both RNG draws even for a one-row span. */
export function randomChestContents(pass: MissionPass, mask: number): RandomChestDraw {
  const enabled = RANDOM_CHEST_GROUPS.filter((group) => (mask & group.bit) !== 0);
  if (enabled.length === 0) return { kind: 'invalid' };
  const group = enabled[pass.ctx.rng.int(enabled.length)];
  if (group === undefined) return { kind: 'invalid' };
  const contents = group.first + pass.ctx.rng.int(group.end - group.first);
  return contents === 0 ? { kind: 'empty' } : { kind: 'contents', contents };
}

type RandomChestOp = Extract<
  MissionResultOp,
  { opcode: 'SetRandomChestOnPosition' | 'SetRandomChestOnRandomPos' }
>;

/** Place the original's wooden random chest, or report that the authored request found no valid spot. */
export function setRandomChest(pass: MissionPass, mission: number, op: RandomChestOp): void {
  const draw = randomChestContents(pass, op.amount);
  if (draw.kind === 'empty') return;
  const terrain = pass.ctx.terrain;
  const type = woodenChestType(terrain);
  if (draw.kind === 'invalid' || terrain === undefined || type === undefined) {
    pass.reportFailed(mission, op.opcode);
    return;
  }
  const point =
    op.opcode === 'SetRandomChestOnPosition'
      ? nearestFreeLand(pass, terrain, op.point)
      : randomFreeLand(pass, terrain);
  if (point === null || !setLandscape(pass.world, pass.ctx, point, type.typeId, draw.contents)) {
    pass.reportFailed(mission, op.opcode);
    return;
  }
  invalidateLandscapeRoutes(pass.world, terrain);
  pass.ctx.events.emit({ kind: 'missionLandscapeChanged' });
}

function woodenChestType(terrain: TerrainGraph | undefined): ScriptLandscapeType | undefined {
  return terrain?.landscapes?.types.find((type) => type.chest?.kind === 'wooden');
}

function nearestFreeLand(
  pass: MissionPass,
  terrain: TerrainGraph,
  origin: HalfCellNode,
): HalfCellNode | null {
  if (!terrain.inBounds(origin.hx, origin.hy)) return null;
  const component = terrain.componentOf(terrain.nodeAt(origin.hx, origin.hy));
  if (component < 0) return null;
  const blocked = dynamicBlockOverlay(pass.world, pass.ctx, terrain);
  const free = (point: HalfCellNode): boolean => {
    if (!terrain.inBounds(point.hx, point.hy)) return false;
    const node = terrain.nodeAt(point.hx, point.hy);
    return terrain.componentOf(node) === component && !blocked.has(node);
  };
  for (let radius = 0; radius <= NEARBY_SEARCH_RADIUS; radius++) {
    for (const { point } of hexagonRing(origin, radius)) if (free(point)) return point;
  }
  return null;
}

function randomFreeLand(pass: MissionPass, terrain: TerrainGraph): HalfCellNode | null {
  for (let attempt = 0; attempt < RANDOM_POSITION_ATTEMPTS; attempt++) {
    const origin = { hx: pass.ctx.rng.int(terrain.width), hy: pass.ctx.rng.int(terrain.height) };
    const point = nearestFreeLand(pass, terrain, origin);
    if (point === null) continue;
    const blocked = dynamicBlockOverlay(pass.world, pass.ctx, terrain);
    if (hexNeighboursOf(point.hx, point.hy).every((neighbour) => isFree(terrain, blocked, neighbour)))
      return point;
  }
  return null;
}

function isFree(
  terrain: TerrainGraph,
  blocked: { readonly has: (node: NodeId) => boolean },
  point: HalfCellNode,
): boolean {
  if (!terrain.inBounds(point.hx, point.hy)) return false;
  const node = terrain.nodeAt(point.hx, point.hy);
  return terrain.isWalkable(node) && !blocked.has(node);
}
