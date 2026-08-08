import type { ContentSet } from '@open-northland/data';
import { Simulation, type TerrainMap } from '@open-northland/sim';
import { weaponEquipmentFor } from '../sandbox/index.js';
import type { AuthoredPlacement } from './authored-placements.js';

/** Every playable world runs with signpost confinement on, so a civilian acts only within its local
 *  circle and its player's reachable network. Each builder enqueues it rather than the sim defaulting
 *  to it, which keeps pre-signpost goldens byte-identical. */
export function newWorldSim(seed: number, map: TerrainMap, content: ContentSet): Simulation {
  const sim = new Simulation({ seed, content, map });
  sim.enqueueSetup({ kind: 'setSignpostNavigation', enabled: true });
  return sim;
}

/**
 * Enqueue resolved placements in list order, so determinism follows the placement list. Buildings are
 * forced because both callers place fixture state that loads as-is, exactly as the original loads a
 * scenario map; the tech and collision gates govern the player's interactive placements instead.
 */
export function enqueuePlacements(sim: Simulation, placements: readonly AuthoredPlacement[]): void {
  for (const p of placements) {
    if (p.kind === 'animal') {
      sim.enqueueSetup({ kind: 'spawnAnimalHerd', tribe: p.tribe, x: p.x, y: p.y, count: 1 });
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
      });
    }
  }
}
