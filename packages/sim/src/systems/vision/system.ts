import type { ContentSet } from '@open-northland/data';
import {
  Building,
  FOG_MODE,
  fogMode,
  fogSettings,
  isValidPlayer,
  metContactBits,
  Owner,
  Palisade,
  Position,
  recordContact,
  Settler,
  SettlerProgress,
  UnderConstruction,
  Upgrading,
  Vehicle,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Fixed } from '../../core/fixed.js';
import type { Component, Entity, World } from '../../ecs/world.js';
import { nodeHxOfPosition, nodeHyOfPosition, nodeOfPosition } from '../../nav/halfcell.js';
import type { System } from '../context.js';
import { isNonWorkingAge } from '../lifecycle/ageclass.js';
import { SCOUT_EXPERIENCE_TYPE, scoutVisionBonusNodes } from '../progression/index.js';
import {
  HEADQUARTERS_BUILDING_ID,
  isFighterJob,
  isHeroJob,
  isHunterJob,
  isScoutJob,
  isShipVehicle,
  isSiegeVehicle,
} from '../readviews/index.js';
import { alliedVisionGroups } from './allies.js';
import { cellOfNode } from './gates.js';
import { FOG_STATE, type FogState } from './state.js';

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
 * on screen. Original behavior: adult 10, child 5, scout and hero 20, house 15, headquarters 30, cart 15,
 * small ship 20, big ship 25, catapult 20, in map-point hexagons. Ours are tuned by the project owner: the
 * child, hero, headquarters, cart, big ship and catapult radii are the original's, the adult trades see
 * further, and both ships see like the big one.
 */
export const CIVILIAN_VISION_NODES = 12;
export const CHILD_VISION_NODES = 5;
export const HUNTER_VISION_NODES = 14;
export const SOLDIER_VISION_NODES = 16;
export const HERO_VISION_NODES = 20;
export const SCOUT_VISION_NODES = 26;
export const BUILDING_VISION_NODES = 20;
export const HEADQUARTERS_VISION_NODES = 30;
export const CART_VISION_NODES = 15;
export const SIEGE_VISION_NODES = 20;
export const SHIP_VISION_NODES = 25;

/** The vision radius in nodes of a settler of `jobType`; a jobless settler or a beast takes the civilian
 *  radius, a baby or child its own. */
export function visionRadiusForJob(content: ContentSet, jobType: number | null): number {
  if (isScoutJob(content, jobType)) return SCOUT_VISION_NODES;
  if (isHeroJob(content, jobType)) return HERO_VISION_NODES;
  if (isFighterJob(content, jobType)) return SOLDIER_VISION_NODES;
  if (isHunterJob(content, jobType)) return HUNTER_VISION_NODES;
  if (isNonWorkingAge(jobType)) return CHILD_VISION_NODES;
  return CIVILIAN_VISION_NODES;
}

/** Nodes explored around where a settler's shot is aimed, a catapult stone is aimed, and a fisher's catch
 *  came from. Original behavior for the shots; the catch is the original's half adult radius plus one,
 *  kept at 6 by owner ruling. */
export const SHOT_SIGHT_NODES = 1;
export const SIEGE_SHOT_SIGHT_NODES = 2;
export const CATCH_SIGHT_NODES = 6;

/**
 * Explore `radius` nodes around `at` for `player` at once, off the rebuild cadence. Under fog of war the
 * ground shows until the next rebuild lowers it to explored: under one cadence, and not at all when a
 * system ordered before vision explores on a rebuild tick. Nothing with fog off, in a mapless sim, or for
 * no player.
 */
export function exploreAround(
  fog: FogState | undefined,
  player: number | null | undefined,
  at: { readonly x: Fixed; readonly y: Fixed },
  radius: number,
): void {
  if (fog === undefined || fog.activeMode === FOG_MODE.OFF) return;
  if (player === null || player === undefined || !isValidPlayer(player)) return;
  const n = nodeOfPosition(at.x, at.y);
  const { cx, cy } = cellOfNode(n.hx, n.hy);
  if (fog.stampSight(player, cx, cy, radius)) fog.generation++;
}

/** The kinds an owned eye can be, in {@link visionRadiusOf}'s order: the passes walk these stores alone,
 *  so owned entities that neither see nor introduce their owner (a signpost, a road site) cost them
 *  nothing. */
const EYE_KINDS: readonly Component<unknown>[] = [Settler, Building, Vehicle];

/** The kinds whose sighting introduces their owner: every owned kind but a signpost and a road site. */
const MET_KINDS: readonly Component<unknown>[] = [Settler, Building, Vehicle, Palisade];

/** A viewer and the players it has met, hoisted out of the contact pass. */
interface ViewerBits {
  readonly viewer: number;
  bits: number;
}

/**
 * Rebuild the per-group fog masks on the {@link VISION_CADENCE_TICKS} cadence, and immediately on a mode
 * change so a `setFogMode` command takes effect the same tick. Runs before the combatSystem in
 * `SYSTEM_ORDER`, so combat gates on this tick's (at worst a cadence-stale) visibility. Without fog of
 * war exploration is sticky, matching the original's observed behaviour. Every eye stamps its owner's
 * vision group, so allies sharing vision explore, see and meet as one.
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

  // Regroup first, so a stance changed since the last rebuild joins or splits the masks before this
  // rebuild's downgrade and stamps: a member leaving an alliance stops seeing what the others see now.
  let changed = fog.setVisionGroups(alliedVisionGroups(world)) || modeChanged;

  // Downgrade pass (fog of war): ground no eye covers falls back to explored, a script's revealed byte
  // excepted. Masks walk in ascending-group order, the order hashState mixes them in, and each scan
  // covers only that group's may-hold-VISIBLE box.
  if (settings.fogOfWar) {
    for (const group of fog.groupsWithMasks()) {
      if (fog.downgradeVisible(group)) changed = true;
    }
  }

  // Stamp pass: writes are idempotent and commutative, so query order needs no canonical sort. Without
  // fog of war no byte ever falls back, so the pass memoizes each eye's footprint.
  fog.beginStampPass(!settings.fogOfWar);
  // An entity of two eye kinds stamps the same footprint twice, which writes nothing new.
  for (const kind of EYE_KINDS) {
    for (const e of world.query(kind, Owner, Position)) {
      const radius = visionRadiusOf(world, ctx.content, e);
      if (radius === null) continue;
      const p = world.get(e, Position);
      const { cx, cy } = cellOfNode(nodeHxOfPosition(p.x, p.y), nodeHyOfPosition(p.y));
      if (fog.stampEye(e, world.get(e, Owner).player, cx, cy, radius)) changed = true;
    }
  }
  fog.endStampPass();

  // Contact pass over the settled masks: a viewer meets every owner whose entity stands on a cell the
  // viewer's group has explored, in sight now or not (reading: the original tests the viewer's once-set
  // explored bit under the entity every tick). Signposts and road sites do not introduce their owner
  // (project rule for road sites); every member of a group with a mask views through it. The met bits
  // are hoisted out of the loop so a saturated world pays per-pair integer tests only, and an entity of
  // two kinds visited twice meets nobody new; the list is re-read because a stamp may have allocated a group's
  // first mask.
  const viewerBits: ViewerBits[] = fog
    .groupsWithMasks()
    .flatMap((group) =>
      fog.visionGroupMembers(group).map((viewer) => ({ viewer, bits: metContactBits(world, viewer) })),
    );
  for (const kind of MET_KINDS) {
    for (const e of world.query(kind, Owner, Position)) meetOwnerOf(world, fog, viewerBits, e);
  }

  fog.activeMode = mode;
  fog.lastRebuildTick = ctx.tick;
  // Only a rebuild that moved a byte or the mode bumps it: every fog consumer, the sim's contested
  // ground among them, re-reads the masks on a bump, and a quiet Classic rebuild writes nothing.
  if (changed) fog.generation++;
};

/** Record every viewer that has explored the cell under `e` as having met its owner. */
function meetOwnerOf(world: World, fog: FogState, viewerBits: readonly ViewerBits[], e: Entity): void {
  const owner = world.get(e, Owner).player;
  if (!isValidPlayer(owner)) return; // never meetable - skip before any per-entity work
  const ownerBit = 1 << owner;
  if (viewerBits.every((v) => v.viewer === owner || (v.bits & ownerBit) !== 0)) return;
  const p = world.get(e, Position);
  const { cx, cy } = cellOfNode(nodeHxOfPosition(p.x, p.y), nodeHyOfPosition(p.y));
  for (const v of viewerBits) {
    if (v.viewer === owner || (v.bits & ownerBit) !== 0) continue;
    if (fog.stateAt(v.viewer, cx, cy) >= FOG_STATE.EXPLORED) {
      recordContact(world, v.viewer, owner);
      v.bits |= ownerBit;
    }
  }
}

/** The vision radius in nodes of one owned entity, or null when it is not an eye. A construction site
 *  sees nothing until it stands (original behavior), while a building under upgrade keeps its sight. */
function visionRadiusOf(world: World, content: ContentSet, e: Entity): number | null {
  const settler = world.tryGet(e, Settler);
  if (settler !== undefined) {
    const base = visionRadiusForJob(content, settler.jobType);
    return isScoutJob(content, settler.jobType)
      ? base + scoutVisionBonusNodes(world.get(e, SettlerProgress).experience.get(SCOUT_EXPERIENCE_TYPE) ?? 0)
      : base;
  }
  const building = world.tryGet(e, Building);
  if (building !== undefined) {
    if (world.has(e, UnderConstruction) && !world.has(e, Upgrading)) return null;
    const type = contentIndex(content).buildings.get(building.buildingType);
    return type?.id === HEADQUARTERS_BUILDING_ID ? HEADQUARTERS_VISION_NODES : BUILDING_VISION_NODES;
  }
  const vehicle = world.tryGet(e, Vehicle);
  if (vehicle !== undefined) {
    const type = contentIndex(content).vehicles.get(vehicle.vehicleType);
    if (type === undefined) return CART_VISION_NODES;
    if (isShipVehicle(type)) return SHIP_VISION_NODES;
    return isSiegeVehicle(type) ? SIEGE_VISION_NODES : CART_VISION_NODES;
  }
  return null;
}
