import { components, type Entity, halfCellMapFromCells, systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { TERRAIN_OPEN } from '../../src/catalog/terrain.js';
import { HUMAN_PLAYER } from '../../src/game/rules.js';
import { GATHERERS, resourceSpecFor } from '../../src/game/sandbox/index.js';
import { runAuthoredSlice } from '../../src/slice/vertical-slice.js';
import { hasRealIr, loadContentUnderTest } from './helpers.js';

const { GroundDrop, Resource, Settler, Stockpile } = components;

/** The real viking ids the decoded-map flow resolves (jobtypes.ini / goods.ini). */
const VIKING = 1;
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
 * Decoded-map apprenticeship rule: authored humans spawn with NO experience, so real content's
 * `needforgood` gates (iron/gold behind clay/stone-digging repeats, `needforgood 6/7 10` over
 * tracks 4+5) hold until the settler earns them in play - the scene-only veteran stamp
 * (`gatherMasteryExperience`) deliberately does NOT apply here.
 */
describe.runIf(hasRealIr())('authored decoded-map humans - gathering XP gates', () => {
  it('a fresh authored collector cannot dig iron until it earns the clay/stone repeats', async () => {
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
    const sim = runAuthoredSlice(7, 1, map, entities, rows, { content: merge.content });
    expect(sim).not.toBeNull();
    if (sim === null) return;

    const settlers = [...sim.world.query(Settler)];
    expect(settlers.length).toBe(1); // the one authored human
    const collector = settlers[0] as Entity;
    expect(sim.world.get(collector, Settler).jobType).toBe(JOB_COLLECTOR);
    expect(sim.world.get(collector, Settler).experience.size).toBe(0); // spawns fresh, no veteran stamp

    // Plant iron beside the unit and flag it there - the gate must keep the deposit untouched.
    const ironSpec = GATHERERS.find((g) => g.good === GOOD_IRON);
    expect(ironSpec).toBeDefined();
    if (ironSpec === undefined) return;
    const node = systems.createResourceNode(
      sim.world,
      sim.content,
      resourceSpecFor(ironSpec, 24 * 2, 20 * 2),
    );
    expect(node).not.toBeNull();
    if (node === null) return;
    sim.enqueue({ kind: 'setWorkFlag', entity: collector, x: 22 * 2, y: 22 * 2 });
    const before = sim.world.get(node, Resource).remaining;
    sim.run(800);
    expect(sim.world.get(node, Resource).remaining).toBe(before); // gated: a fresh collector digs no iron

    // Earn the gate the way play would (clay/stone repeats), seeded directly onto the settler: the
    // viking `needforgood` row for iron sums repeats across its named tracks, so its first track
    // (collector mud) at the full amount clears it.
    const tribeType = merge.content.tribes.find((t) => t.typeId === VIKING);
    const ironNeed = tribeType?.jobRequirements.find(
      (r) => r.requirement === 'need' && r.target === 'good' && r.targetId === GOOD_IRON,
    );
    expect(ironNeed).toBeDefined(); // real content does gate iron
    if (ironNeed === undefined) return;
    const trackId = ironNeed.experienceTypes[0];
    expect(trackId).toBeDefined();
    if (trackId === undefined) return;
    const track = merge.content.jobExperience.find((t) => t.typeId === trackId);
    sim.world
      .get(collector, Settler)
      .experience.set(trackId, systems.rawXpForRepeats(track, ironNeed.amount));

    sim.run(2500);
    // Earned: the deposit is mined (a fully exhausted node dies, so a dead node counts as zero).
    const after = sim.world.isAlive(node) ? sim.world.get(node, Resource).remaining : 0;
    expect(after).toBeLessThan(before);
    // And the dug ore reached the flag side (banked as a loose heap, not left as its raw drop).
    let banked = 0;
    for (const e of sim.world.query(Stockpile)) {
      if (sim.world.has(e, GroundDrop)) continue;
      banked += sim.world.get(e, Stockpile).amounts.get(GOOD_IRON) ?? 0;
    }
    expect(banked).toBeGreaterThan(0);
  }, 120000);
});
