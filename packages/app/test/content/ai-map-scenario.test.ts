import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { components } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { buildCollisionTerrain } from '../../src/content/collision.js';
import { buildingFootprints, type ContentIr } from '../../src/content/ir.js';
import { mapResourceObjectNames, spawnMapResources } from '../../src/game/sandbox/index.js';
import type { AuthoredJoinRows } from '../../src/slice/authored-placements.js';
import { runAuthoredSlice } from '../../src/slice/vertical-slice.js';
import { contentDir, hasRealIr, loadContentUnderTest, rawIrUnderTest } from './helpers.js';

const { Building, Owner, Settler, UnderConstruction, WorkFlag, isAiPlayer } = components;

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
  // A heavy real-content run: ~17k spawned resource nodes + 120 ticks with AI decisions.
  it('an AI-flagged seat opens its build order from the authored headquarters', {
    timeout: 60_000,
  }, async () => {
    const { merge } = await loadContentUnderTest();
    const map = JSON.parse(readFileSync(mapPath(), 'utf8'));
    // The raw fetched-IR document, exactly what the browser flow hands these consumers.
    const ir = rawIrUnderTest() as ContentIr & AuthoredJoinRows;
    // Resolve the headquarters typeId from the served IR by its stable id (the same 'headquarters'
    // join the sim keys on) rather than inlining the decoded number, so the assertion still checks
    // the HQ if the decoded typeId ever shifts.
    const hqType = ir.buildings?.find((b) => b.id === 'headquarters')?.typeId;
    expect(hqType).toBeDefined();
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
    // The map's own trees/stone/clay as harvestable Resource nodes — the `?map=` entry does the
    // same spawn, and the collectors flag themselves beside these.
    spawnMapResources(sim, map.objects, ir);
    sim.run(RUN_TICKS);

    expect(isAiPlayer(sim.world, AI_SEAT)).toBe(true);
    // The opening build order is running: the seat opened at least one construction site of its own.
    let sites = 0;
    let hq: number | null = null;
    for (const e of sim.world.query(Building, Owner)) {
      if (sim.world.get(e, Owner).player !== AI_SEAT) continue;
      if (sim.world.has(e, UnderConstruction)) sites++;
      else if (sim.world.get(e, Building).buildingType === hqType) hq = e;
    }
    expect(hq).not.toBeNull(); // the authored headquarters resolved and stayed built
    expect(sites).toBe(1); // one site at a time (the concurrent-construction cap)
    // The workforce allocator flagged collectors beside real resources: each owned flag-bound
    // gatherer is pinned to one collected good. How many of the three goods get a collector depends
    // on what the map actually holds, but a forest map guarantees at least the wood one.
    const pinned: number[] = [];
    for (const e of sim.world.query(Settler, WorkFlag)) {
      if (sim.world.tryGet(e, Owner)?.player !== AI_SEAT) continue;
      const goodType = sim.world.get(e, WorkFlag).goodType;
      if (goodType !== undefined) pinned.push(goodType);
    }
    expect(pinned.length).toBeGreaterThanOrEqual(1);
    expect(pinned.length).toBeLessThanOrEqual(3);
    expect(new Set(pinned).size).toBe(pinned.length); // one collector per good, never two
  });
});
