import type { Simulation } from '@open-northland/sim';
import { cellAnchorNode, components, positionOfNode } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { grassTerrain } from '../../src/catalog/buildings.js';
import { JOB_COLLECTOR } from '../../src/catalog/jobs.js';
import { HUMAN_PLAYER } from '../../src/game/rules.js';
import { placeBuiltSandboxBuilding, spawnSandboxSettler } from '../../src/game/sandbox/index.js';
import { createSceneSim } from '../../src/scenes/index.js';
import type { SceneDefinition } from '../../src/scenes/types.js';
import { hasRealIr, loadContentUnderTest } from './helpers.js';

/**
 * Defence mode over REAL content: a building on alarm only fires while civilians sit inside it, so every
 * tribe's defence house must let them in through its extracted door, and its house bow must reach any
 * archer shooting at it.
 */

const HOUSE_BOW_ID = 'house_bow';
const MAP_W = 40;
const MAP_H = 40;
const BUILDING_CELL = { x: 20, y: 20 } as const;
/** Anchor node-row offsets of each parity: under an odd anchor row a footprint's odd rows stamp one node
 *  further east. */
const ANCHOR_ROW_SHIFTS = [0, 1] as const;
const CIVILIANS = 4;
const CIVILIAN_ROW = 30;
const SHELTER_TICKS = 400;

const { Building, Position, Resting, Sheltering } = components;

function shelteredIn(sim: Simulation): number {
  let inside = 0;
  for (const e of sim.world.query(Sheltering)) {
    if (sim.world.tryGet(e, Resting)?.at === sim.world.get(e, Sheltering).shelter) inside++;
  }
  return inside;
}

function alarmScene(buildingId: string, tribe: number, rowShift: number): SceneDefinition {
  return {
    id: `defence-${buildingId}-${tribe}-${rowShift}`,
    seed: 1,
    terrain: grassTerrain(MAP_W, MAP_H),
    runTicks: SHELTER_TICKS,
    checks: [],
    build: (sim) => {
      const { x, y } = BUILDING_CELL;
      const building = placeBuiltSandboxBuilding(sim, buildingId, x, y, HUMAN_PLAYER);
      sim.world.mut(building, Building).tribe = tribe;
      const anchor = cellAnchorNode(x, y);
      sim.world.add(building, Position, positionOfNode(anchor.hx, anchor.hy + rowShift));
      for (let i = 0; i < CIVILIANS; i++) {
        spawnSandboxSettler(
          sim,
          JOB_COLLECTOR,
          BUILDING_CELL.x - CIVILIANS + 2 * i,
          CIVILIAN_ROW,
          HUMAN_PLAYER,
        );
      }
      sim.enqueueSetup({ kind: 'setDefenceMode', building, enabled: true });
    },
  };
}

describe.runIf(hasRealIr())('defence buildings on real content', () => {
  it("every tribe's house bow outranges every hand-held ranged weapon", async () => {
    const { merge } = await loadContentUnderTest();
    const weapons = merge.content.weapons;
    const houseBows = weapons.filter((w) => w.id === HOUSE_BOW_ID);
    const handBows = weapons.filter(
      (w) => w.id !== HOUSE_BOW_ID && w.munitionType !== undefined && w.damageType === undefined,
    );
    expect(houseBows.length).toBeGreaterThan(0);
    const longest = Math.max(...handBows.map((w) => w.maxRange));
    for (const bow of houseBows) expect(bow.maxRange, `tribe ${bow.tribeType}`).toBeGreaterThan(longest);
  });

  it("every tribe's defence houses take their civilians in on either anchor-row parity", {
    timeout: 120_000,
  }, async () => {
    const { merge } = await loadContentUnderTest();
    const houseBowTribes = new Set<number>();
    for (const w of merge.content.weapons) {
      if (w.id === HOUSE_BOW_ID && w.tribeType !== undefined) houseBowTribes.add(w.tribeType);
    }
    const refused: string[] = [];
    for (const type of merge.content.buildings.filter((b) => b.shelterCapacity > 0)) {
      for (const tribe of houseBowTribes) {
        for (const rowShift of ANCHOR_ROW_SHIFTS) {
          const scene = alarmScene(type.id, tribe, rowShift);
          const sim = createSceneSim(scene, { content: merge.content });
          sim.run(scene.runTicks);
          if (shelteredIn(sim) === 0) refused.push(`${type.id} tribe ${tribe} row parity ${rowShift}`);
        }
      }
    }
    expect(refused).toEqual([]);
  });
});
