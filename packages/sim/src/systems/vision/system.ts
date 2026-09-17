import type { ContentSet } from '@open-northland/data';
import {
  Building,
  FOG_MODE,
  fogMode,
  fogSettings,
  isValidPlayer,
  metContactBits,
  Owner,
  Position,
  recordContact,
  Settler,
  SettlerProgress,
  SIGNPOST_VISION_NODES,
  Signpost,
  Vehicle,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { System } from '../context.js';
import { SCOUT_EXPERIENCE_TYPE, scoutVisionBonusNodes } from '../progression/index.js';
import { isFighterJob, isHunterJob, isScoutJob } from '../readviews/index.js';
import { cellOfNode } from './gates.js';
import { FOG_STATE } from './state.js';

/**
 * Ticks between visibility-mask rebuilds. Positions move every tick but the masks refresh on this cadence,
 * so per-tick cost amortizes to (stamped eyes × vision area) / 5 writes, a ~417 ms refresh at 12 ticks/s:
 * every eye under fog of war, only the eyes that moved without it.
 * Approximation: the original has no observable fog refresh rate.
 */
export const VISION_CADENCE_TICKS = 5;

/**
 * Vision radii in half-cell nodes, measured along the E/W world axis (one node = half a column = 34 px of the
 * measured 68×38 pitch); the stamped area is the world-metric ellipse of that radius, so vision reads circular
 * on screen. Approximation: the original carries no readable per-job sight field, so the ordering is authored.
 */
export const BUILDING_VISION_NODES = 20;
export const CIVILIAN_VISION_NODES = 12;
export const HUNTER_VISION_NODES = 14;
export const SOLDIER_VISION_NODES = 16;
export const SCOUT_VISION_NODES = 26;

/** The vision radius in nodes of a settler of `jobType`; a jobless settler or child takes the civilian floor. */
export function visionRadiusForJob(content: ContentSet, jobType: number | null): number {
  if (isScoutJob(content, jobType)) return SCOUT_VISION_NODES;
  if (isFighterJob(content, jobType)) return SOLDIER_VISION_NODES;
  if (isHunterJob(content, jobType)) return HUNTER_VISION_NODES;
  return CIVILIAN_VISION_NODES;
}

/**
 * Rebuild the per-group fog masks on the {@link VISION_CADENCE_TICKS} cadence, and immediately on a mode
 * change so a `setFogMode` command takes effect the same tick. Runs before the combatSystem in
 * `SYSTEM_ORDER`, so combat gates on this tick's (at worst a cadence-stale) visibility. Without fog of
 * war exploration is sticky, matching the original's observed behaviour. Every eye stamps its owner's
 * vision group, so players sharing vision explore, see and meet as one.
 */
export const visionSystem: System = (world, ctx) => {
  const fog = ctx.fog;
  if (fog === undefined) return; // mapless sim - no grid to mask
  const mode = fogMode(world);
  const settings = fogSettings(mode);
  if (settings === null) {
    if (fog.activeMode !== FOG_MODE.OFF) {
      fog.reset(); // exploration restarts if fog is switched back on
      fog.activeMode = FOG_MODE.OFF;
      fog.lastRebuildTick = -1;
      fog.generation++;
    }
    return;
  }

  const modeChanged = mode !== fog.activeMode;
  const due = fog.lastRebuildTick === -1 || ctx.tick - fog.lastRebuildTick >= VISION_CADENCE_TICKS;
  if (!modeChanged && !due) return;

  // Downgrade pass (fog of war): ground no eye covers falls back to explored, a script's revealed byte
  // excepted. Masks walk in ascending-group order, the order hashState mixes them in, and each scan
  // covers only that group's may-hold-VISIBLE box.
  let changed = modeChanged;
  if (settings.fogOfWar) {
    for (const group of fog.groupsWithMasks()) {
      if (fog.downgradeVisible(group)) changed = true;
    }
  }

  // Stamp pass: writes are idempotent and commutative, so query order needs no canonical sort. Without
  // fog of war no byte ever falls back, so the pass memoizes each eye's footprint.
  fog.beginStampPass(!settings.fogOfWar);
  for (const e of world.query(Owner, Position)) {
    const radius = visionRadiusOf(world, ctx.content, e);
    if (radius === null) continue; // an owned entity that is not an eye (a flag, a pile)
    const p = world.get(e, Position);
    const n = nodeOfPosition(p.x, p.y);
    const { cx, cy } = cellOfNode(n.hx, n.hy);
    if (fog.stampEye(e, world.get(e, Owner).player, cx, cy, radius)) changed = true;
  }
  fog.endStampPass();

  // Contact pass over the settled masks: a viewer meets every owner whose entity stands on a cell the
  // viewer's group has explored, in sight now or not (reading: the original tests the viewer's once-set
  // explored bit under the entity every tick). Signposts do not introduce their owner; every member of
  // a group with a mask views through it. The met bits are hoisted out of the loop so a saturated world
  // pays per-pair integer tests only; the list is re-read because a stamp may have allocated a group's
  // first mask.
  const viewerBits = fog
    .groupsWithMasks()
    .flatMap((group) =>
      fog.visionGroupMembers(group).map((viewer) => ({ viewer, bits: metContactBits(world, viewer) })),
    );
  for (const e of world.query(Owner, Position)) {
    if (world.has(e, Signpost)) continue;
    const owner = world.get(e, Owner).player;
    if (!isValidPlayer(owner)) continue; // never meetable - skip before any per-entity work
    const ownerBit = 1 << owner;
    if (viewerBits.every((v) => v.viewer === owner || (v.bits & ownerBit) !== 0)) continue;
    const p = world.get(e, Position);
    const n = nodeOfPosition(p.x, p.y);
    const { cx, cy } = cellOfNode(n.hx, n.hy);
    for (const v of viewerBits) {
      if (v.viewer === owner || (v.bits & ownerBit) !== 0) continue;
      if (fog.stateAt(v.viewer, cx, cy) >= FOG_STATE.EXPLORED) {
        recordContact(world, v.viewer, owner);
        v.bits |= ownerBit;
      }
    }
  }

  fog.activeMode = mode;
  fog.lastRebuildTick = ctx.tick;
  // Only a rebuild that moved a byte or the mode bumps it: every fog consumer, the sim's contested
  // ground among them, re-reads the masks on a bump, and a quiet Classic rebuild writes nothing.
  if (changed) fog.generation++;
};

/** The vision radius in nodes of one owned entity, or null when it is not an eye. A rising site counts as
 *  manned ground and sees the building radius, a vehicle sees like a civilian (approximation), and a
 *  signpost is an authored standing eye that keeps {@link SIGNPOST_VISION_NODES} around it visible under
 *  fog of war. */
function visionRadiusOf(world: World, content: ContentSet, e: Entity): number | null {
  const settler = world.tryGet(e, Settler);
  if (settler !== undefined) {
    const base = visionRadiusForJob(content, settler.jobType);
    return isScoutJob(content, settler.jobType)
      ? base + scoutVisionBonusNodes(world.get(e, SettlerProgress).experience.get(SCOUT_EXPERIENCE_TYPE) ?? 0)
      : base;
  }
  if (world.has(e, Building)) return BUILDING_VISION_NODES;
  if (world.has(e, Vehicle)) return CIVILIAN_VISION_NODES;
  if (world.has(e, Signpost)) return SIGNPOST_VISION_NODES;
  return null;
}
