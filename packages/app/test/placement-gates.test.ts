import { cellAnchorNode, components, halfCellMapFromCells, Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { grassTerrain } from '../src/catalog/buildings.js';
import { JOB_SOLDIER_SWORD } from '../src/catalog/jobs.js';
import { ENEMY_PLAYER, HUMAN_PLAYER } from '../src/game/rules.js';
import {
  BUILDING_HOME_00,
  resolveWorldContent,
  spawnSandboxSettler,
  WEAPON_SWORD,
} from '../src/game/sandbox/index.js';
import { createFogGates } from '../src/view/projections/index.js';
import { createPlacementGates, type PlacementGates } from '../src/view/runtime/placement-gates.js';

const MAP_W = 24;
const MAP_H = 12;
/** The enemy swordsman's cell, and a site two cells off him against one across the map. */
const RAIDER = { x: 6, y: 4 };
const NEAR = cellAnchorNode(8, 4);
const FAR = cellAnchorNode(18, 8);

function openField(): { sim: Simulation; gates: PlacementGates } {
  const terrain = grassTerrain(MAP_W, MAP_H);
  const sim = new Simulation({
    seed: 1,
    content: resolveWorldContent(terrain, {}),
    map: halfCellMapFromCells(terrain),
  });
  const fog = createFogGates();
  fog.setFrame(null); // fog off: only the placement rules decide
  return { sim, gates: createPlacementGates(sim, fog, HUMAN_PLAYER) };
}

describe('placement gates - the ground an enemy army contests', () => {
  it('refuses the click and the ghost beside an enemy soldier, and admits them again once he is gone', () => {
    const { sim, gates } = openField();
    expect(gates.canPlaceAt(BUILDING_HOME_00, NEAR.hx, NEAR.hy)).toBe(true);
    expect(gates.canPlaceAt(BUILDING_HOME_00, FAR.hx, FAR.hy)).toBe(true);

    spawnSandboxSettler(sim, JOB_SOLDIER_SWORD, RAIDER.x, RAIDER.y, ENEMY_PLAYER, {
      weaponTypeId: WEAPON_SWORD,
    });
    sim.step();
    expect(gates.canPlaceAt(BUILDING_HOME_00, NEAR.hx, NEAR.hy)).toBe(false);
    expect(gates.canPlaceAt(BUILDING_HOME_00, FAR.hx, FAR.hy)).toBe(true);

    for (const e of [...sim.world.query(components.Settler)]) sim.world.destroy(e);
    expect(gates.canPlaceAt(BUILDING_HOME_00, NEAR.hx, NEAR.hy)).toBe(true);
  });
});
