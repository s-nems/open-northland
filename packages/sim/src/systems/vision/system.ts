import type { ContentSet } from '@open-northland/data';
import {
  Building,
  FOG_MODE,
  fogMode,
  fogSettings,
  isValidPlayer,
  MAX_PLAYERS,
  metContactBits,
  Owner,
  Palisade,
  Position,
  recordContact,
  Settler,
  UnderConstruction,
  Upgrading,
  Vehicle,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Fixed } from '../../core/fixed.js';
import type { Component, Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { System } from '../context.js';
import { isNonWorkingAge } from '../lifecycle/ageclass.js';
import {
  HEADQUARTERS_BUILDING_ID,
  isFighterJob,
  isHeroJob,
  isScoutJob,
  isShipVehicle,
  isSiegeVehicle,
} from '../readviews/index.js';
import { moverNode } from '../spatial/mover-node.js';
import { heldMoverNode } from '../spatial/node-moves.js';
import { alliedVisionGroups } from './allies.js';
import { eyeChangesOf } from './eye-changes.js';
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
 * headquarters, big ship and catapult radii are the original's, everyone else sees further, and both ships
 * see like the big one.
 */
export const CIVILIAN_VISION_NODES = 15;
export const CHILD_VISION_NODES = 10;
export const SOLDIER_VISION_NODES = 20;
export const HERO_VISION_NODES = 25;
export const SCOUT_VISION_NODES = 30;
export const BUILDING_VISION_NODES = 20;
export const HEADQUARTERS_VISION_NODES = 30;
export const CART_VISION_NODES = 20;
export const SIEGE_VISION_NODES = 20;
export const SHIP_VISION_NODES = 25;

/** The vision radius in nodes of a settler of `jobType`; a jobless settler or a beast takes the civilian
 *  radius, a baby or child its own. */
export function visionRadiusForJob(content: ContentSet, jobType: number | null): number {
  if (isScoutJob(content, jobType)) return SCOUT_VISION_NODES;
  if (isHeroJob(content, jobType)) return HERO_VISION_NODES;
  if (isFighterJob(content, jobType)) return SOLDIER_VISION_NODES;
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

/** A viewer, the players it has met and its group's mask, hoisted out of the contact pass. */
interface ViewerBits {
  readonly viewer: number;
  bits: number;
  readonly mask: Uint8Array | undefined;
}

/** The contact pass's viewers plus the owners some viewer other than the owner has yet to meet, so an
 *  entity whose owner everyone has met costs one bit test. */
interface ContactPass {
  readonly viewers: readonly ViewerBits[];
  readonly cellsWide: number;
  readonly cellsHigh: number;
  unmetOwners: number;
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
  // fog of war no byte ever falls back, so the pass memoizes each eye's footprint, and while that memo
  // holds every eye it visits only the entities whose footprint may have changed.
  const memoizing = !settings.fogOfWar;
  verifyEyeMemoOf(world, fog, ctx.content);
  const changedEyes = eyeChangesOf(world).take(memoizing, fog.eyeMemo);
  fog.beginStampPass(memoizing, changedEyes !== null);
  // An entity of two eye kinds stamps the same footprint twice, which writes nothing new.
  const radii = eyeRadiiOf(ctx.content);
  if (changedEyes === null) {
    for (const kind of EYE_KINDS) {
      for (const e of world.query(kind, Owner, Position)) {
        const radius = visionRadiusOf(world, radii, e);
        if (radius !== null && stampEyeOf(world, fog, e, radius)) changed = true;
      }
    }
  } else {
    // One visit per entity: a second kind's visit would find its footprint memoized.
    for (let i = 0; i < changedEyes.length; i++) {
      const e = changedEyes[i] as Entity;
      const radius = isOwnedEyeKind(world, e) ? visionRadiusOf(world, radii, e) : null;
      if (radius === null) fog.forgetEye(e);
      else if (stampEyeOf(world, fog, e, radius)) changed = true;
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
  const viewers: ViewerBits[] = fog.groupsWithMasks().flatMap((group) =>
    fog.visionGroupMembers(group).map((viewer) => ({
      viewer,
      bits: metContactBits(world, viewer),
      mask: fog.tryMaskFor(viewer),
    })),
  );
  const contacts: ContactPass = {
    viewers,
    cellsWide: fog.cellsWide,
    cellsHigh: fog.cellsHigh,
    unmetOwners: 0,
  };
  for (let owner = 0; owner < MAX_PLAYERS; owner++) {
    if (!everyViewerMet(viewers, owner)) contacts.unmetOwners |= 1 << owner;
  }
  for (const kind of MET_KINDS) {
    for (const e of world.query(kind, Owner, Position)) meetOwnerOf(world, contacts, e);
  }

  fog.activeMode = mode;
  fog.lastRebuildTick = ctx.tick;
  // Only a rebuild that moved a byte or the mode bumps it: every fog consumer, the sim's contested
  // ground among them, re-reads the masks on a bump, and a quiet Classic rebuild writes nothing.
  if (changed) fog.generation++;
};

/** The fog and content the eye-memo verifier of a world reads, updated by each rebuild. */
interface EyeMemoSubject {
  fog: FogState;
  content: ContentSet;
}

const eyeMemoSubjects = new WeakMap<World, EyeMemoSubject>();

/** Register `world`'s eye-memo verifier once, and point it at this rebuild's fog and content. */
function verifyEyeMemoOf(world: World, fog: FogState, content: ContentSet): void {
  const held = eyeMemoSubjects.get(world);
  if (held !== undefined) {
    held.fog = fog;
    held.content = content;
    return;
  }
  const subject: EyeMemoSubject = { fog, content };
  eyeMemoSubjects.set(world, subject);
  world.registerCacheVerifier('fogEyeMemo', () => verifyEyeMemo(world, subject));
}

/**
 * While the next rebuild would visit only changed eyes, every live eye not pending in the change feeds
 * must hold a memo matching its current footprint, and nothing else may hold one: a footprint change no
 * feed reported would never be stamped. Peeks the feeds, so it changes nothing.
 */
function verifyEyeMemo(world: World, { fog, content }: EyeMemoSubject): string[] {
  const changes = eyeChangesOf(world);
  if (!changes.replays(fog.eyeMemo)) return [];
  const pending = new Set<Entity>();
  if (changes.peek((e) => pending.add(e))) return [];
  const violations: string[] = [];
  const radii = eyeRadiiOf(content);
  const eyes = new Set<Entity>();
  for (const kind of EYE_KINDS) {
    for (const e of world.query(kind, Owner, Position)) {
      if (pending.has(e) || eyes.has(e)) continue;
      const radius = visionRadiusOf(world, radii, e);
      if (radius === null) continue;
      eyes.add(e);
      const node = moverNode(world, e, world.get(e, Position));
      const { cx, cy } = cellOfNode(node.hx, node.hy);
      if (!fog.holdsEyeStamp(e, world.get(e, Owner).player, cx, cy, radius)) {
        violations.push(`fog: eye ${e} has no memo for its footprint, a change no feed reported`);
      }
    }
  }
  fog.forEachMemoizedEye((e) => {
    if (!eyes.has(e) && !pending.has(e)) violations.push(`fog: entity ${e} holds an eye memo but is no eye`);
  });
  return violations;
}

/** Whether `e` is alive, owned, positioned and of an eye kind: one the full stamp pass visits. */
function isOwnedEyeKind(world: World, e: Entity): boolean {
  if (!world.isAlive(e) || !world.has(e, Owner) || !world.has(e, Position)) return false;
  for (let i = 0; i < EYE_KINDS.length; i++)
    if (world.has(e, EYE_KINDS[i] as Component<unknown>)) return true;
  return false;
}

/** Stamp the sight of eye `e`, owned and positioned, `radius` nodes wide; whether a byte rose. */
function stampEyeOf(world: World, fog: FogState, e: Entity, radius: number): boolean {
  const node = heldMoverNode(world, e);
  const { cx, cy } = cellOfNode(node.hx, node.hy);
  return fog.stampEye(e, world.get(e, Owner).player, cx, cy, radius);
}

function everyViewerMet(viewers: readonly ViewerBits[], owner: number): boolean {
  const ownerBit = 1 << owner;
  return viewers.every((v) => v.viewer === owner || (v.bits & ownerBit) !== 0);
}

/** Record every viewer that has explored the cell under `e` as having met its owner. */
function meetOwnerOf(world: World, contacts: ContactPass, e: Entity): void {
  const owner = world.get(e, Owner).player;
  if (!isValidPlayer(owner)) return; // never meetable - skip before any per-entity work
  const ownerBit = 1 << owner;
  if ((contacts.unmetOwners & ownerBit) === 0) return;
  const node = heldMoverNode(world, e);
  const { cx, cy } = cellOfNode(node.hx, node.hy);
  const { cellsWide, cellsHigh } = contacts;
  if (cx < 0 || cy < 0 || cx >= cellsWide || cy >= cellsHigh) return; // off-grid reads UNEXPLORED
  const index = cy * cellsWide + cx;
  for (const v of contacts.viewers) {
    if (v.viewer === owner || (v.bits & ownerBit) !== 0) continue;
    // Any byte but UNEXPLORED is at least explored, a revealed one included.
    if (v.mask !== undefined && v.mask[index] !== FOG_STATE.UNEXPLORED) {
      recordContact(world, v.viewer, owner);
      v.bits |= ownerBit;
    }
  }
  if (everyViewerMet(contacts.viewers, owner)) contacts.unmetOwners &= ~ownerBit;
}

/** The per-content lookups behind {@link visionRadiusOf}, so an eye costs a map read, not a content
 *  walk. */
interface EyeRadii {
  readonly content: ContentSet;
  readonly jobs: Map<number | null, number>;
  readonly buildings: Map<number, number>;
  readonly vehicles: Map<number, number>;
}

const eyeRadiiCache = new WeakMap<ContentSet, EyeRadii>();

function eyeRadiiOf(content: ContentSet): EyeRadii {
  let radii = eyeRadiiCache.get(content);
  if (radii === undefined) {
    radii = { content, jobs: new Map(), buildings: new Map(), vehicles: new Map() };
    eyeRadiiCache.set(content, radii);
  }
  return radii;
}

/** The vision radius in nodes of one owned entity, or null when it is not an eye. A construction site
 *  sees nothing until it stands (original behavior), while a building under upgrade keeps its sight. */
function visionRadiusOf(world: World, radii: EyeRadii, e: Entity): number | null {
  const { content } = radii;
  const settler = world.tryGet(e, Settler);
  if (settler !== undefined) {
    const jobType = settler.jobType;
    let base = radii.jobs.get(jobType);
    if (base === undefined) {
      base = visionRadiusForJob(content, jobType);
      radii.jobs.set(jobType, base);
    }
    return base;
  }
  const building = world.tryGet(e, Building);
  if (building !== undefined) {
    if (world.has(e, UnderConstruction) && !world.has(e, Upgrading)) return null;
    let radius = radii.buildings.get(building.buildingType);
    if (radius === undefined) {
      const type = contentIndex(content).buildings.get(building.buildingType);
      radius = type?.id === HEADQUARTERS_BUILDING_ID ? HEADQUARTERS_VISION_NODES : BUILDING_VISION_NODES;
      radii.buildings.set(building.buildingType, radius);
    }
    return radius;
  }
  const vehicle = world.tryGet(e, Vehicle);
  if (vehicle !== undefined) {
    let radius = radii.vehicles.get(vehicle.vehicleType);
    if (radius === undefined) {
      radius = vehicleVisionRadius(content, vehicle.vehicleType);
      radii.vehicles.set(vehicle.vehicleType, radius);
    }
    return radius;
  }
  return null;
}

function vehicleVisionRadius(content: ContentSet, vehicleType: number): number {
  const type = contentIndex(content).vehicles.get(vehicleType);
  if (type === undefined) return CART_VISION_NODES;
  if (isShipVehicle(type)) return SHIP_VISION_NODES;
  return isSiegeVehicle(type) ? SIEGE_VISION_NODES : CART_VISION_NODES;
}
