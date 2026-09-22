import type {
  ContentSet,
  MapAiSeat,
  MapDiplomacy,
  MapHumanName,
  MapRelationFlag,
  MapScript,
  MapTradeAgreement,
} from '@open-northland/data';
import { components, type MissionScript, Simulation, systems, type TerrainMap } from '@open-northland/sim';
import { diag } from '../../diag/index.js';
import { weaponEquipmentFor } from '../sandbox/index.js';
import type { AuthoredPlacement } from './authored-placements.js';

/** Decoded map setup and resolved mission definitions. */
export interface MapScriptWorld {
  readonly victory?: 'script' | 'elimination';
  readonly permissions?: MapScript['permissions'];
  readonly diplomacy?: readonly MapDiplomacy[];
  /** The `[playermisc]` relation rows; the ones that lock a pair's stances are stood up before tick 0. */
  readonly relationFlags?: readonly MapRelationFlag[];
  /** The `[AIData]` rows: the seat toggles the builder applies, and the scripted handlers' programs the
   *  simulation runs. */
  readonly ai?: readonly MapAiSeat[];
  readonly humanNames?: readonly MapHumanName[];
  /** The map's `tradeagreement` rows, registered before the first tick. */
  readonly tradeAgreements?: readonly MapTradeAgreement[];
  readonly missions?: MissionScript;
  readonly participants?: readonly number[];
}

/**
 * A map's start stance table: `rows`, then `neutral` for every ordered pair of roster players they
 * leave unset. The original's loader fills an unset pair of existing players with neutral after it
 * reads `[playerdata]`, so two seats a map never names neither fight
 * nor ally. A world without a roster keeps the sim's everyone-hostile default.
 */
export function withNeutralRosterPairs(
  roster: readonly number[],
  rows: readonly MapDiplomacy[],
): readonly MapDiplomacy[] {
  const players = [...new Set(roster)].filter(components.isValidPlayer);
  const stated = new Set(rows.map((row) => `${row.from}:${row.to}`));
  const filled = [...rows];
  for (const from of players) {
    for (const to of players) {
      if (from !== to && !stated.has(`${from}:${to}`)) filled.push({ from, to, state: 'neutral' });
    }
  }
  return filled;
}

/** Every playable world runs with signpost confinement on, so a civilian acts only within its walk
 *  range and its player's caught network. Each builder enqueues it rather than the sim defaulting
 *  to it, which keeps pre-signpost goldens byte-identical. Diplomacy rows are enqueued here too -
 *  before the first tick, so no targeting pass ever runs on the everyone-hostile default - and a
 *  world without rows enqueues none, keeping its command stream byte-identical. */
export function newWorldSim(
  seed: number,
  map: TerrainMap,
  content: ContentSet,
  script: MapScriptWorld = {},
): Simulation {
  const diplomacy = script.diplomacy ?? [];
  const sim = new Simulation({
    seed,
    content,
    map,
    ...(script.missions !== undefined ? { missions: script.missions } : {}),
    ...(script.ai !== undefined && script.ai.length > 0 ? { aiScript: script.ai } : {}),
  });
  if (map.fishSwarms !== undefined && sim.terrain !== undefined) {
    systems.addFishSwarms(sim.world, sim.terrain, map.fishSwarms);
  }
  for (const row of script.permissions ?? []) components.setMapPermission(sim.world, row);
  for (const row of script.relationFlags ?? []) {
    if (row.kind !== 'hideDetails') components.setDiplomacyLock(sim.world, row.a, row.b, true);
  }
  sim.enqueueSetup({ kind: 'setSignpostNavigation', enabled: true });
  for (const row of diplomacy) {
    sim.enqueueSetup({ kind: 'setDiplomacy', from: row.from, to: row.to, state: row.state });
  }
  for (const row of script.tradeAgreements ?? []) sim.enqueueSetup({ kind: 'addTradeAgreement', ...row });
  const dropped = diplomacy.filter(
    (r) => !components.isValidPlayer(r.from) || !components.isValidPlayer(r.to),
  ).length;
  if (dropped > 0) {
    diag.warn(
      'content',
      `newWorldSim: ${dropped} authored diplomacy rows name out-of-range player slots and are skipped by the sim`,
    );
  }
  return sim;
}

/**
 * Authored signposts are assembled before tick zero; other placements enqueue in list order. Buildings are
 * forced because both callers place fixture state that loads as-is, exactly as the original loads a
 * scenario map; the tech and collision gates govern the player's interactive placements instead.
 *
 * The list holds every building before any human, which is what lets a settler's authored home and
 * workplace resolve to a standing building as it spawns.
 */
export function enqueuePlacements(sim: Simulation, placements: readonly AuthoredPlacement[]): void {
  const terrain = sim.terrain;
  if (placements.some((p) => p.kind === 'signpost') && (sim.tick !== 0 || terrain === undefined)) {
    throw new Error('Authored signposts require pre-tick world assembly on a mapped sim');
  }
  for (const p of placements) {
    if (p.kind === 'signpost') {
      if (terrain === undefined) continue; // the guard above already threw for an authored post
      systems.createSignpost(sim.world, terrain, terrain.nodeAt(p.x, p.y), p.owner);
      continue;
    }
    if (p.kind === 'animal') {
      sim.enqueueSetup({
        kind: 'spawnAnimalHerd',
        tribe: p.tribe,
        x: p.x,
        y: p.y,
        count: 1,
        ...(p.owner !== undefined ? { owner: p.owner } : {}),
        ...(p.missionId !== undefined ? { missionId: p.missionId } : {}),
      });
      continue;
    }
    const own = p.owner !== undefined ? { owner: p.owner } : {};
    if (p.kind === 'building') {
      sim.enqueueSetup({
        kind: 'placeBuilding',
        buildingType: p.typeId,
        x: p.x,
        y: p.y,
        tribe: p.tribe,
        force: true,
        ...own,
        ...(p.goods !== undefined ? { initialGoods: p.goods } : {}),
        ...(p.missionId !== undefined ? { missionId: p.missionId } : {}),
      });
    } else {
      // A warrior placement carries its class weapon in the equipment slot, so its drawn weapon and its
      // Broń row agree. Authored humans spawn with no experience, earning the `needfor*` gates normally.
      const equipment = weaponEquipmentFor(p.jobType, sim.content.goods);
      sim.enqueueSetup({
        kind: 'spawnSettler',
        jobType: p.jobType,
        x: p.x,
        y: p.y,
        tribe: p.tribe,
        ...own,
        ...(equipment !== undefined ? { equipment } : {}),
        ...(p.gatherGood !== undefined ? { gatherGood: p.gatherGood } : {}),
        ...(p.nameStringId !== undefined ? { nameStringId: p.nameStringId } : {}),
        ...(p.home !== undefined ? { home: p.home } : {}),
        ...(p.workplace !== undefined ? { workplace: p.workplace } : {}),
        ...(p.missionId !== undefined ? { missionId: p.missionId } : {}),
        ...(p.behaviourFlags !== undefined ? { behaviourFlags: p.behaviourFlags } : {}),
      });
    }
  }
}
