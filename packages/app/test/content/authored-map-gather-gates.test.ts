import { components, halfCellMapFromCells, systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { TERRAIN_OPEN } from '../../src/catalog/terrain.js';
import { HUMAN_PLAYER } from '../../src/game/rules.js';
import { GATHERERS, gatherMasteryExperienceFor, resourceSpecFor } from '../../src/game/sandbox/index.js';
import { runAuthoredSlice } from '../../src/slice/vertical-slice.js';
import { hasRealIr, loadContentUnderTest } from './helpers.js';

const { GroundDrop, Resource, Settler, Stockpile } = components;

/** The real viking ids the decoded-map flow resolves (jobtypes.ini / goods.ini). */
const VIKING = 1;
const JOB_CIVILIST = 6;
const JOB_COLLECTOR = 8;
const GOOD_IRON = 6;

const MAP_CELLS = 40;

function grassMap(cells: number) {
  return halfCellMapFromCells({
    width: cells,
    height: cells,
    typeIds: new Array(cells * cells).fill(TERRAIN_OPEN),
  });
}

/**
 * The decoded-map twin of the sandbox veteran-collector rule (`sandbox-gather-gates.test.ts`): real
 * content gates iron/gold behind clay/stone-digging XP (`needforgood 6/7 10` over tracks 4+5), and a
 * map's authored humans are the settlers the player later converts to collectors — profession changes
 * keep `Settler.experience`, so the mastery stamp at authored spawn is what lets an ex-civilian dig
 * iron. Without it (the 2026-07-16 forteca regression) a converted collector pinned to an iron camp
 * failed `settlerMeetsNeed` forever and stood idle beside its deposit.
 */
describe.runIf(hasRealIr())('authored decoded-map humans — gathering XP gates', () => {
  it('an authored civilian converted to a collector digs iron at its flag', async () => {
    const { merge } = await loadContentUnderTest();
    const map = grassMap(MAP_CELLS);
    // One authored human, the shape a decoded map's `sethuman` resolves to (job by name).
    const entities = {
      buildings: [],
      humans: [{ role: 'collector', tribe: 'viking', hx: 20 * 2, hy: 24 * 2, player: HUMAN_PLAYER }],
      animals: [],
    };
    const rows = {
      jobs: merge.content.jobs.map((j) => ({ typeId: j.typeId, id: j.id, name: j.id })),
      tribes: merge.content.tribes.map((t) => ({ typeId: t.typeId, id: t.id })),
    };
    const sim = runAuthoredSlice(7, 1, map, entities, rows, undefined, undefined, merge.content);
    expect(sim).not.toBeNull();
    if (sim === null) return;

    // The authored spawn carries the mastery stamp that clears the iron/gold `needforgood` gates.
    const mastery = gatherMasteryExperienceFor(merge.content, VIKING);
    expect(mastery.length).toBeGreaterThan(0); // real content does gate gatherables
    let collector = -1;
    for (const e of sim.world.query(Settler)) collector = e as number;
    const xp = sim.world.get(collector as never, Settler).experience;
    for (const [track, points] of mastery) {
      expect(xp.get(track) ?? 0).toBeGreaterThanOrEqual(points);
    }

    // End to end through the profession picker: convert away and back (experience survives setJob),
    // plant iron beside the unit, flag it there, and prove the deposit is actually mined.
    sim.enqueue({ kind: 'setJob', entity: collector as never, jobType: JOB_CIVILIST });
    sim.step();
    sim.enqueue({ kind: 'setJob', entity: collector as never, jobType: JOB_COLLECTOR });
    sim.step();
    const ironSpec = GATHERERS.find((g) => g.good === GOOD_IRON);
    expect(ironSpec).toBeDefined();
    if (ironSpec === undefined) return;
    const node = systems.createResourceNode(
      sim.world,
      sim.content,
      resourceSpecFor(ironSpec, 24 * 2, 20 * 2),
    );
    expect(node).not.toBeNull();
    sim.enqueue({ kind: 'setWorkFlag', entity: collector as never, x: 22 * 2, y: 22 * 2 });

    const before = node !== null ? sim.world.get(node, Resource).remaining : 0;
    sim.run(2500);
    const after = node !== null && sim.world.isAlive(node) ? sim.world.get(node, Resource).remaining : 0;
    expect(after).toBeLessThan(before); // the converted collector cleared the XP gate and mined
    // And the dug ore reached the flag side (banked as a loose heap, not left as its raw drop).
    let banked = 0;
    for (const e of sim.world.query(Stockpile)) {
      if (sim.world.has(e, GroundDrop)) continue;
      banked += sim.world.get(e, Stockpile).amounts.get(GOOD_IRON) ?? 0;
    }
    expect(banked).toBeGreaterThan(0);
  }, 120000);
});
