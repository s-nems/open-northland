import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MapScript, mapLobbySlots, TerrainMapFile } from '@open-northland/data';
import { components, nodeOfPosition, playerCommand } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import type { ContentIr } from '../../src/content/ir/rows.js';
import { buildMapWorldFromInputs } from '../../src/entries/map/world-inputs.js';
import { mapSession } from '../../src/game/session-url.js';
import { contentDir, hasRealIr, loadContentUnderTest, rawIrUnderTest } from './helpers.js';

/**
 * A mountain path on wybrzeze_czarow that the original keeps open between stone heaps: the map's own
 * blocking lane leaves a straight way south from node (16, 226). Blocking every heap at its full-grown
 * size, or as its good's first record, closed it and sent soldiers round the mountains.
 */
const MAP_ID = 'wybrzeze_czarow';
const PATH_TOP = { hx: 16, hy: 226 };
const PATH_BOTTOM = { hx: 15, hy: 280 };
const HUMAN_SEAT = 0;
/** The map's first sword soldier, on the human seat. */
const SOLDIER_MISSION_ID = 30;
/** About twice what the straight walk takes; the way round the mountains takes several times longer. */
const WALK_TICKS = 1500;
/** Half-cell nodes from the goal that count as arrived: an order may stop beside a taken node. */
const ARRIVED_NODES = 2;
const REAL_MAP_TIMEOUT_MS = 120_000;

describe.runIf(hasRealIr())(`${MAP_ID} mountain path`, () => {
  it('lets a soldier walk straight down the path between the stone heaps', {
    timeout: REAL_MAP_TIMEOUT_MS,
  }, async () => {
    const ir = rawIrUnderTest() as ContentIr;
    const { merge } = await loadContentUnderTest();
    const root = resolve(contentDir(), 'maps');
    const map = TerrainMapFile.parse(JSON.parse(readFileSync(resolve(root, `${MAP_ID}.json`), 'utf8')));
    const script = MapScript.parse(JSON.parse(readFileSync(resolve(root, `${MAP_ID}.script.json`), 'utf8')));
    const session = mapSession(new URLSearchParams(`map=${MAP_ID}&player=0`), mapLobbySlots(script));
    const { sim } = buildMapWorldFromInputs({
      map,
      ir,
      script,
      goodNames: new Map(),
      content: merge.content,
      session,
      missions: null,
      save: null,
    });
    const { MissionObjectId, Position, Settler } = components;
    const soldier = [...sim.world.query(Settler, MissionObjectId)].find(
      (e) => sim.world.get(e, MissionObjectId).id === SOLDIER_MISSION_ID,
    );
    if (soldier === undefined) throw new Error(`${MAP_ID} no longer authors soldier ${SOLDIER_MISSION_ID}`);

    sim.enqueueSetup({ kind: 'debugTeleport', target: soldier, x: PATH_TOP.hx, y: PATH_TOP.hy });
    sim.run(1);
    sim.enqueue(
      playerCommand(HUMAN_SEAT, { kind: 'moveUnit', entity: soldier, x: PATH_BOTTOM.hx, y: PATH_BOTTOM.hy }),
    );
    sim.run(WALK_TICKS);

    const at = sim.world.get(soldier, Position);
    const node = nodeOfPosition(at.x, at.y);
    expect(Math.abs(node.hx - PATH_BOTTOM.hx)).toBeLessThanOrEqual(ARRIVED_NODES);
    expect(Math.abs(node.hy - PATH_BOTTOM.hy)).toBeLessThanOrEqual(ARRIVED_NODES);
  });
});
