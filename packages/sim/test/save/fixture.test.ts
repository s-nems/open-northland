import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FOG_MODE, Settler } from '../../src/components/index.js';
import {
  exportSaveGame,
  parseSaveGame,
  restoreSimulation,
  Simulation,
  serializeSaveGame,
} from '../../src/index.js';
import { testContent } from '../fixtures/content.js';
import { grassCellMap } from '../fixtures/terrain.js';

/** Golden guard of the persisted layout: a change that moves the bytes - content, IR, behavior anywhere
 *  in the fixture's tick schedule, or the layout itself - regenerates this one file, and a layout change
 *  also bumps SAVE_FORMAT_VERSION in the same commit. */
const FIXTURE_PATH = fileURLToPath(new URL('../fixtures/save.golden', import.meta.url));

const VIKING = 1;
const P0 = 0;
const P1 = 1;
const JOB_IDLE = 0;
const JOB_SCOUT = 27;
const HQ_BUILDING = 1;
const WOOD_GOOD = 1;
const SHOES_GOOD = 8;
const TOOL_GOOD = 11;
const MAP_CELLS = 8;
/** A reveal in the far corner, so the mask holds the revealed byte beside the scout's sight. */
const REVEAL_POINT = { hx: 14, hy: 14 };
const REVEAL_RANGE = 1;
const FIXTURE_TICKS = 24;
const FIXTURE_MAP_ID = 'fixture';

/** The world the fixture freezes: every section populated - a shared-vision pair and its fog mask
 *  from a scout and a script-style reveal, several component stores, an advanced rng stream, and one
 *  pending envelope. */
function fixtureSim(): Simulation {
  const sim = new Simulation({ seed: 9, content: testContent(), map: grassCellMap(MAP_CELLS, MAP_CELLS) });
  sim.enqueueSetup({ kind: 'setFogMode', mode: FOG_MODE.RECON_FOG_OF_WAR });
  sim.enqueueSetup({ kind: 'setSharedVision', players: [P0, P1] });
  sim.enqueueSetup({ kind: 'spawnSettler', jobType: JOB_SCOUT, x: 4, y: 4, tribe: VIKING, owner: P0 });
  sim.enqueueSetup({ kind: 'spawnSettler', jobType: JOB_IDLE, x: 8, y: 8, tribe: VIKING, owner: P0 });
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: HQ_BUILDING,
    x: 10,
    y: 10,
    tribe: VIKING,
    owner: P0,
  });
  sim.enqueueSetup({ kind: 'dropGood', good: WOOD_GOOD, x: 6, y: 6, amount: 3 });
  sim.enqueueSetup({ kind: 'dropGood', good: SHOES_GOOD, x: 6, y: 8, amount: 1 });
  sim.enqueueSetup({ kind: 'dropGood', good: TOOL_GOOD, x: 6, y: 10, amount: 1 });
  sim.run(FIXTURE_TICKS);
  sim.fog?.revealArea(P0, REVEAL_POINT, REVEAL_RANGE); // after the setup pass: joining a group drops masks
  const scout = [...sim.world.query(Settler)][0];
  if (scout === undefined) throw new Error('save fixture scout missing');
  sim.enqueueSetup({ kind: 'equipGood', entity: scout, group: 'boots', slot: 0, goodType: SHOES_GOOD });
  sim.enqueueSetup({ kind: 'equipGood', entity: scout, group: 'tool', slot: 0, goodType: TOOL_GOOD });
  sim.step(); // freeze one active equip order with the second intent queued behind it
  sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
  return sim;
}

describe('committed save fixture', () => {
  it('is reproduced byte for byte by exporting the fixture world', () => {
    const bytes = serializeSaveGame(exportSaveGame(fixtureSim(), { mapId: FIXTURE_MAP_ID }));
    if (process.env.UPDATE_SAVE_FIXTURE === '1') writeFileSync(FIXTURE_PATH, `${bytes}\n`);
    expect(readFileSync(FIXTURE_PATH, 'utf8')).toBe(`${bytes}\n`);
  });

  it('parses, restores, and re-exports byte-identically on the current build', () => {
    const committed = readFileSync(FIXTURE_PATH, 'utf8').trimEnd();
    const save = parseSaveGame(JSON.parse(committed));
    const sim = restoreSimulation(save, {
      content: testContent(),
      map: grassCellMap(MAP_CELLS, MAP_CELLS),
    });
    expect(sim.checkInvariants()).toEqual([]);
    expect(serializeSaveGame(exportSaveGame(sim, { mapId: FIXTURE_MAP_ID }))).toBe(committed);
  });
});
