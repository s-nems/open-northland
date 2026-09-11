import type { ContentSet, MapDiplomacy, MapHumanName } from '@open-northland/data';
import { components, type MissionScript, Simulation, type TerrainMap } from '@open-northland/sim';
import { diag } from '../../diag/index.js';
import { weaponEquipmentFor } from '../sandbox/index.js';
import type { AuthoredPlacement } from './authored-placements.js';

/** Decoded map setup and resolved mission definitions. */
export interface MapScriptWorld {
  readonly diplomacy?: readonly MapDiplomacy[];
  readonly humanNames?: readonly MapHumanName[];
  readonly missions?: MissionScript;
  readonly participants?: readonly number[];
}

/** Every playable world runs with signpost confinement on, so a civilian acts only within its local
 *  circle and its player's reachable network. Each builder enqueues it rather than the sim defaulting
 *  to it, which keeps pre-signpost goldens byte-identical. Authored diplomacy rows are enqueued here
 *  too - before the first tick, so no targeting pass ever runs on the everyone-hostile default - and a
 *  map without rows enqueues none, keeping its command stream byte-identical. */
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
  });
  sim.enqueueSetup({ kind: 'setSignpostNavigation', enabled: true });
  for (const row of diplomacy) {
    sim.enqueueSetup({ kind: 'setDiplomacy', from: row.from, to: row.to, state: row.state });
  }
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
 * Enqueue resolved placements in list order, so determinism follows the placement list. Buildings are
 * forced because both callers place fixture state that loads as-is, exactly as the original loads a
 * scenario map; the tech and collision gates govern the player's interactive placements instead.
 *
 * The list holds every building before any human, which is what lets a settler's authored home and
 * workplace resolve to a standing building as it spawns.
 */
export function enqueuePlacements(sim: Simulation, placements: readonly AuthoredPlacement[]): void {
  for (const p of placements) {
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
