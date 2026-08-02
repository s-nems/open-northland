import type { ContentSet } from '@open-northland/data';
import { Simulation, type TerrainMap } from '@open-northland/sim';
import { weaponEquipmentFor } from '../sandbox/index.js';
import type { AuthoredPlacement } from './authored-placements.js';

/** Signpost navigation confinement is a game fundament: every playable world runs with it ON - a
 *  civilian acts only within its local circle + its player's reachable signpost network (scouts and
 *  fighters roam free). Enqueued per builder (scenes get it in `createSceneSim`), keeping the sim-level
 *  default off so pre-signpost goldens stay byte-identical. */
export function newWorldSim(seed: number, map: TerrainMap, content: ContentSet): Simulation {
  const sim = new Simulation({ seed, content, map });
  sim.enqueue({ kind: 'setSignpostNavigation', enabled: true });
  return sim;
}

/**
 * Enqueue resolved placements in order - the one spot the `placeBuilding`/`spawnSettler` command
 * shapes are written, shared by the demo strip and the authored import (list order = enqueue order,
 * so determinism follows the placement list). Buildings are forced: both callers place fixture state
 * (a decoded map's authored houses, the pinned demo world) which loads as-is, exactly as the original
 * loads a scenario map - the tech/collision gates govern the player's interactive placements.
 */
export function enqueuePlacements(sim: Simulation, placements: readonly AuthoredPlacement[]): void {
  for (const p of placements) {
    if (p.kind === 'animal') {
      // One authored setanimal = one creature at its half-cell (never a maximumgroupsize herd).
      sim.enqueue({ kind: 'spawnAnimalHerd', tribe: p.tribe, x: p.x, y: p.y, count: 1 });
      continue;
    }
    const own = p.owner !== undefined ? { owner: p.owner } : {};
    if (p.kind === 'building') {
      sim.enqueue({
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
      // A warrior placement (scene author or imported-map `sethuman`) carries its class weapon in the
      // equipment slot, so an existing soldier's Broń row + drawn weapon match - like an admin spawn.
      // Authored humans spawn with NO experience: a map's starting population earns the `needfor*`
      // gates like everyone else (dig clay/stone before iron - the original's apprenticeship).
      // `sethuman`'s undecoded trailing columns (tools/asset-pipeline maps decoder) may carry the
      // original per-human stats and would be the source to pin if a map does seed veterans.
      const equipment = weaponEquipmentFor(p.jobType, sim.content.goods);
      sim.enqueue({
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
