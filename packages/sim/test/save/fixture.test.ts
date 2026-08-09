import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FOG_MODE } from '../../src/components/index.js';
import {
  exportSaveGame,
  parseSaveGame,
  restoreSimulation,
  Simulation,
  serializeSaveGame,
} from '../../src/index.js';
import { testContent } from '../fixtures/content.js';
import { grassCellMap } from '../fixtures/terrain.js';

/**
 * Golden guard of the persisted layout: the committed bytes must stay loadable forever. Any change
 * that moves the bytes - content, IR, or behavior anywhere in the fixture's tick schedule - only
 * needs a regeneration. A layout change is held to more: bump SAVE_FORMAT_VERSION, register the
 * migration, demote this fixture to a historical parse-and-restore case, and commit a new
 * current-format fixture.
 */
const FIXTURE_PATH = fileURLToPath(new URL('../fixtures/save-v2.golden', import.meta.url));

/** Historical layout, frozen at its last v1 regeneration; only the migration seam keeps it loadable. */
const V1_FIXTURE_PATH = fileURLToPath(new URL('../fixtures/save-v1.golden', import.meta.url));

const VIKING = 1;
const P0 = 0;
const JOB_IDLE = 0;
const JOB_SCOUT = 27;
const HQ_BUILDING = 1;
const WOOD_GOOD = 1;
const MAP_CELLS = 8;
const FIXTURE_TICKS = 24;
const FIXTURE_MAP_ID = 'fixture';

/** The world the fixture freezes: every section populated - fog masks from a scout, several
 *  component stores, an advanced rng stream, and one pending envelope. */
function fixtureSim(): Simulation {
  const sim = new Simulation({ seed: 9, content: testContent(), map: grassCellMap(MAP_CELLS, MAP_CELLS) });
  sim.enqueueSetup({ kind: 'setFogMode', mode: FOG_MODE.RECON });
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
  sim.run(FIXTURE_TICKS);
  sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
  return sim;
}

describe('committed v2 save fixture', () => {
  it('is reproduced byte for byte by exporting the fixture world', () => {
    const bytes = serializeSaveGame(exportSaveGame(fixtureSim(), { mapId: FIXTURE_MAP_ID }));
    if (process.env.UPDATE_SAVE_FIXTURE === '1') writeFileSync(FIXTURE_PATH, `${bytes}\n`);
    expect(readFileSync(FIXTURE_PATH, 'utf8')).toBe(`${bytes}\n`);
  });

  it('parses, restores, and re-exports byte-identically on the current build', () => {
    const committed = readFileSync(FIXTURE_PATH, 'utf8').trimEnd();
    const save = parseSaveGame(JSON.parse(committed));
    const { sim, contentRevisionDiffers } = restoreSimulation(save, {
      content: testContent(),
      map: grassCellMap(MAP_CELLS, MAP_CELLS),
    });
    expect(contentRevisionDiffers).toBe(false);
    expect(sim.checkInvariants()).toEqual([]);
    expect(serializeSaveGame(exportSaveGame(sim, { mapId: FIXTURE_MAP_ID }))).toBe(committed);
  });
});

describe('committed v1 save fixture', () => {
  it('still parses through the migration seam and restores', () => {
    const committed = readFileSync(V1_FIXTURE_PATH, 'utf8').trimEnd();
    const save = parseSaveGame(JSON.parse(committed));
    expect(save.header.formatVersion).toBe(2);
    expect(save.header.entry).toBeNull();
    const { sim } = restoreSimulation(save, {
      content: testContent(),
      map: grassCellMap(MAP_CELLS, MAP_CELLS),
    });
    expect(sim.checkInvariants()).toEqual([]);
  });
});
