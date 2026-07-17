import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { components } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { buildCollisionTerrain } from '../../src/content/collision.js';
import { buildingFootprints } from '../../src/content/ir.js';
import { mapResourceObjectNames } from '../../src/game/sandbox/index.js';
import { runAuthoredSlice } from '../../src/slice/vertical-slice.js';
import { contentDir, hasRealIr, loadContentUnderTest, rawIrUnderTest } from './helpers.js';

const { Building, GatherSelection, JobAssignment, Owner, UnderConstruction, isAiPlayer } = components;

/** The decoded map under test — a free-play start where every seat opens with an authored, stocked
 *  viking headquarters (the fortress-map convention the AI keys on). */
const MAP_ID = 'magiczny_las';
/** A seat with an authored HQ that no session defaults to (the human default is seat 0). */
const AI_SEAT = 2;
/** Five strategic decisions for the seat — the opening orders all fire on the first one. */
const RUN_TICKS = 120;

function mapPath(): string {
  return resolve(contentDir(), `maps/${MAP_ID}.json`);
}

/**
 * The strategic AI player against a REAL decoded map (the `?map=...&ai=<seat>` flow): the flagged
 * seat must act on its authored headquarters through the same merged content the browser runs —
 * this is the headless twin of watching the AI play on a real map, and it guards the id joins the
 * synthetic sim fixtures cannot (real building/good ids, authored owners, real footprints).
 */
describe.runIf(hasRealIr() && existsSync(mapPath()))('strategic AI on a decoded map', () => {
  it('an AI-flagged seat opens its build order from the authored headquarters', async () => {
    const { merge } = await loadContentUnderTest();
    const map = JSON.parse(readFileSync(mapPath(), 'utf8'));
    const ir = rawIrUnderTest() as Parameters<typeof buildCollisionTerrain>[1];
    const simMap = buildCollisionTerrain(map, ir, mapResourceObjectNames(ir));
    const sim = runAuthoredSlice(
      7,
      1,
      simMap,
      map.entities,
      ir,
      buildingFootprints(ir),
      undefined,
      merge.content,
    );
    expect(sim).not.toBeNull();
    if (sim === null) return;
    sim.enqueue({ kind: 'setPlayerAi', player: AI_SEAT, enabled: true });
    sim.run(RUN_TICKS);

    expect(isAiPlayer(sim.world, AI_SEAT)).toBe(true);
    // The opening build order is running: the seat opened at least one construction site of its own.
    let sites = 0;
    let hq: number | null = null;
    for (const e of sim.world.query(Building, Owner)) {
      if (sim.world.get(e, Owner).player !== AI_SEAT) continue;
      if (sim.world.has(e, UnderConstruction)) sites++;
      else if (sim.world.get(e, Building).buildingType === 1) hq = e;
    }
    expect(hq).not.toBeNull(); // the authored headquarters resolved and stayed built
    expect(sites).toBeGreaterThanOrEqual(1);
    expect(sites).toBeLessThanOrEqual(2);
    // The workforce allocator bound its HQ gatherers with per-good selections.
    let selections = 0;
    for (const e of sim.world.query(JobAssignment, GatherSelection)) {
      if (sim.world.get(e, JobAssignment).workplace === hq) selections++;
    }
    expect(selections).toBe(3);
  });
});
