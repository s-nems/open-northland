import { type ContentSet, jsonFingerprint, type MapModules } from '@open-northland/data';
import {
  type MapAiScript,
  MapAiState,
  missionRecords,
  missionStateExists,
  PathFollow,
  type PathFollowState,
  Position,
  type PositionState,
  pathFollowRecord,
  positionRecord,
} from '../components/index.js';
import { assertNever } from '../core/brand.js';
import { isPlainRecord, PROTO_KEY, valueShapeName } from '../core/plain-value.js';
import { type Component, componentByName } from '../ecs/component.js';
import type { Entity } from '../ecs/world.js';
import type { TerrainMap } from '../nav/terrain/index.js';
import { Simulation } from '../simulation.js';
import type { MissionScript } from '../systems/missions/index.js';
import { syncRoadLane } from '../systems/roads/index.js';
import { REVEALED_BYTE } from '../systems/vision/index.js';
import { simContentFingerprint } from './content-fingerprint.js';
import { type ComponentSection, type FogSection, SAVE_MAP_KEY, type SaveGame } from './format.js';
import { warmWorldIndexes } from './warm.js';

export interface RestoreOptions {
  content: ContentSet;
  /** The decoded map the save was taken on; required iff the save's header names a map fingerprint. */
  map?: TerrainMap;
  /** The map's mission script; required iff the save carries mission records, and it must be the
   *  script the run was saved on. */
  missions?: MissionScript;
  /** The map's `[AIData]` rows, on the same terms for a save that carries a seat's program state. */
  mapAiScript?: MapAiScript;
  /** The map's modules, which must be the ones the run was saved under. */
  mapModules?: MapModules;
}

/**
 * Build a fresh {@link Simulation} standing at a validated save's tick boundary: stores in saved
 * registration and insertion order, the RNG stream position, fog masks with their derived bounds
 * rebuilt, and the pending command queue. Throws naming the failing path on any save the loaded
 * content or map cannot honor; a rejected save constructs nothing the caller can see.
 */
export function restoreSimulation(save: SaveGame, opts: RestoreOptions): Simulation {
  const header = save.header;
  const loaded = opts.content.manifest;
  if (header.irVersion !== loaded.version) {
    throw new Error(
      `save.header.irVersion: the save was built on IR v${header.irVersion}, the loaded content is v${loaded.version}`,
    );
  }
  if (
    header.contentFingerprint !== null &&
    header.contentFingerprint !== simContentFingerprint(opts.content)
  ) {
    throw new Error('save.header.contentFingerprint: the loaded content differs from the save');
  }
  const missionFingerprint = opts.missions === undefined ? null : jsonFingerprint(opts.missions);
  if (header.missionScriptFingerprint !== missionFingerprint) {
    throw new Error('save.header.missionScriptFingerprint: the loaded mission script differs from the save');
  }
  const aiFingerprint = opts.mapAiScript === undefined ? null : jsonFingerprint(opts.mapAiScript);
  if (header.mapAiScriptFingerprint !== aiFingerprint) {
    throw new Error('save.header.mapAiScriptFingerprint: the loaded map AI script differs from the save');
  }
  const modulesFingerprint = opts.mapModules === undefined ? null : jsonFingerprint(opts.mapModules);
  if (header.mapModulesFingerprint !== modulesFingerprint) {
    throw new Error('save.header.mapModulesFingerprint: the loaded map modules differ from the save');
  }
  const sim = new Simulation({
    seed: header.seed,
    content: opts.content,
    ...(opts.map !== undefined ? { map: opts.map } : {}),
    ...(opts.missions !== undefined ? { missions: opts.missions } : {}),
    ...(opts.mapAiScript !== undefined ? { mapAiScript: opts.mapAiScript } : {}),
    ...(opts.mapModules !== undefined ? { mapModules: opts.mapModules } : {}),
  });
  const fingerprint = sim.mapFingerprint ?? null;
  if (fingerprint !== header.mapFingerprint) {
    throw new Error(
      `save.header.mapFingerprint: the save's map is ${JSON.stringify(header.mapFingerprint)}, the restore target has ${JSON.stringify(fingerprint)}`,
    );
  }
  for (const section of save.sections) {
    switch (section.id) {
      case 'entities':
        sim.world.restoreAllocation(section.nextId, section.alive as readonly Entity[]);
        break;
      case 'component':
        restoreStore(sim, section);
        break;
      case 'rng':
        sim.rng.setState(section.state);
        break;
      case 'names':
        sim.names.restore(section.cursors);
        break;
      case 'fog':
        restoreFog(sim, section);
        break;
      case 'commands':
        sim.commands.restore(section.pending, section.nextSequence, section.continuation, header.tick);
        break;
      default:
        assertNever(section);
    }
  }
  sim.names.validate(sim.world);
  sim.restoreTick(header.tick);
  if (sim.terrain !== undefined) syncRoadLane(sim.world, sim.terrain);
  assertMissionScriptMatches(sim, opts.missions);
  assertMapAiScriptMatches(sim, opts.mapAiScript);
  // Structural validation cannot see that a saved reference points at a settler with no marriage or a
  // building nobody owns. The core invariants can, and a save that fails them would otherwise throw
  // on every tick of a world the player already believes they loaded.
  const violations = sim.checkInvariants();
  if (violations.length > 0) {
    throw new Error(`save state violates the core invariants: ${violations.join('; ')}`);
  }
  warmWorldIndexes(sim);
  return sim;
}

/**
 * Mission records are positional over the script's own order, and the script is not saved, so a
 * restore handed another map's script - or none - would map every record to the wrong mission and
 * run it. The `mapFingerprint` check covers the terrain, not the `.script.json` beside it.
 */
function assertMissionScriptMatches(sim: Simulation, missions: MissionScript | undefined): void {
  if (!missionStateExists(sim.world)) return;
  const saved = missionRecords(sim.world).length;
  const wired = missions?.missions.length ?? 0;
  if (saved !== wired) {
    throw new Error(
      `save.sections: the save carries ${saved} mission records, the restore target's script has ${wired}`,
    );
  }
}

/** A seat's program records are positional over its rows like the mission records, so each saved
 *  program must find its seat's rows, with as many conditions and at least as many tasks. */
function assertMapAiScriptMatches(sim: Simulation, mapAiScript: MapAiScript | undefined): void {
  for (const e of sim.world.query(MapAiState)) {
    const program = sim.world.get(e, MapAiState);
    const rows = mapAiScript?.find((row) => row.player === program.player);
    const slots = rows === undefined ? 0 : Math.max(0, ...rows.conditions.map((c) => c.slot + 1));
    const tasks = (rows?.tasks.length ?? 0) + (program.defaultDefend !== null ? 1 : 0);
    if (program.conditions.length !== slots || program.tasks.length > tasks) {
      throw new Error(
        `save.sections: seat ${program.player}'s AI program does not fit the restore target's [AIData] rows`,
      );
    }
  }
}

/** Hot stores whose restored records are rebuilt in the key order live code writes them. A record
 *  materialized key by key takes another hidden class than a live object literal, and the movement and
 *  separation passes would read restored and live records polymorphically for as long as both live. */
const RECORD_FACTORIES = new Map<Component<unknown>, (value: unknown) => unknown>([
  [PathFollow, (value) => pathFollowRecord(value as PathFollowState)],
  [Position, (value) => positionRecord(value as PositionState)],
]);

function restoreStore(sim: Simulation, section: ComponentSection): void {
  const component = componentByName(section.name);
  if (component === undefined) {
    throw new Error(`save.sections: unknown component '${section.name}'`);
  }
  const factory = RECORD_FACTORIES.get(component);
  const entries = section.entries.map(([entity, value]) => {
    const materialized = materializedValue(value, `component:${section.name}/${entity}`);
    return [entity as Entity, factory === undefined ? materialized : factory(materialized)] as const;
  });
  sim.world.restoreStore(component, entries);
}

function restoreFog(sim: Simulation, section: FogSection): void {
  const fog = sim.fog;
  if (fog === undefined) {
    throw new Error('save.sections: a fog section needs a mapped sim');
  }
  fog.setVisionGroups(section.sharedVision);
  for (const [group, digits] of section.masks) {
    fog.restoreMask(group, maskBytes(digits, group));
  }
  fog.activeMode = section.activeMode;
  fog.lastRebuildTick = section.lastRebuildTick;
}

const DIGIT_ZERO = '0'.charCodeAt(0);
const DIGIT_MAX = DIGIT_ZERO + REVEALED_BYTE;

/** The inverse of export's digit encoding: one mask byte per character, the revealed byte the highest. */
function maskBytes(digits: string, group: number): Uint8Array {
  const mask = new Uint8Array(digits.length);
  for (let i = 0; i < digits.length; i++) {
    const code = digits.charCodeAt(i);
    if (code < DIGIT_ZERO || code > DIGIT_MAX) {
      throw new Error(`fog mask for group ${group} leaves the mask digit alphabet at cell ${i}`);
    }
    mask[i] = code - DIGIT_ZERO;
  }
  return mask;
}

/**
 * The runtime value of one saved component entry: a fresh deep copy with every `{'$map': entries}`
 * wrapper rebuilt as a live `Map` in its saved (insertion) order. Throws naming `path` for any shape
 * a save cannot legally carry.
 */
function materializedValue(value: unknown, path: string): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path}: non-finite number does not survive JSON`);
    return value;
  }
  if (Array.isArray(value)) {
    const out = new Array<unknown>(value.length);
    for (let i = 0; i < value.length; i++) out[i] = materializedValue(value[i], `${path}[${i}]`);
    return out;
  }
  if (isPlainRecord(value)) {
    if (Object.hasOwn(value, SAVE_MAP_KEY)) return materializedMap(value, path);
    // A parsed `__proto__` is an own key here but a prototype assignment in the copy below, which
    // would leave a value the snapshot, hash, and export walks all reject from then on.
    if (Object.hasOwn(value, PROTO_KEY)) {
      throw new Error(`${path}: the key '${PROTO_KEY}' cannot round-trip as plain data`);
    }
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) out[key] = materializedValue(value[key], `${path}.${key}`);
    return out;
  }
  throw new Error(`${path}: unrestorable value shape ${valueShapeName(value)}`);
}

function materializedMap(value: Record<string, unknown>, path: string): Map<unknown, unknown> {
  const entries = value[SAVE_MAP_KEY];
  if (Object.keys(value).length !== 1 || !Array.isArray(entries)) {
    throw new Error(`${path}: malformed '${SAVE_MAP_KEY}' Map encoding`);
  }
  const map = new Map<unknown, unknown>();
  entries.forEach((entry: unknown, i) => {
    if (!Array.isArray(entry) || entry.length !== 2) {
      throw new Error(`${path}[${i}]: expected a [key, value] Map entry`);
    }
    const key = materializedValue(entry[0], `${path}[${i}].key`);
    if (map.has(key)) throw new Error(`${path}[${i}].key: duplicate Map key ${JSON.stringify(key)}`);
    map.set(key, materializedValue(entry[1], `${path}[${i}]`));
  });
  return map;
}
