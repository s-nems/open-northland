import { components, type Entity, type Simulation, systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { grassTerrain } from '../../../src/catalog/buildings.js';
import { JOB_BUILDER } from '../../../src/catalog/jobs.js';
import { WALL_HITPOINTS_PER_VALENCY } from '../../../src/content/map/palisade-rows.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../../../src/game/rules.js';
import {
  GOOD_WOOD,
  PALISADE_HORIZONTAL_GATE_CLOSED_GFX_INDEX,
  PALISADE_WALL_GFX_INDEX,
  spawnSandboxSettlerDirect,
} from '../../../src/game/sandbox/index.js';
import { createSceneSim } from '../../../src/scenes/runtime.js';

const { Damaged, Health, Palisade, Stockpile, UnderConstruction } = components;

const MAP_W = 16;
const MAP_H = 10;
const WALL_AT = { hx: 14, hy: 10 } as const;
const BUILDER_AT = { x: 7, y: 7 } as const;
/** A wall site rises in one strike; a post mends 149 valency points at +5 a strike, a gate 299 at +3. */
const POST_BUILD_STRIKES = 1;
const POST_REPAIR_STRIKES = 30;
const GATE_REPAIR_STRIKES = 100;
/** Long enough for a lone builder to finish a hundred gate strikes. */
const MAX_TICKS = 12_000;

/** The pool scale a wall is measured on: the engine's hitpoints, or the valency points they stand for. */
type Scale = 'hitpoints' | 'valency';

/** A sim with one builder and one wall of `gfxIndex`, set back to the valency scale when asked. */
function wallWithBuilder(gfxIndex: number, scale: Scale, underConstruction: boolean): [Simulation, Entity] {
  let wall: Entity | null = null;
  const sim = createSceneSim({
    seed: 1,
    terrain: grassTerrain(MAP_W, MAP_H),
    build: (s) => {
      const terrain = s.terrain;
      const type = terrain === undefined ? undefined : systems.palisadeType(terrain, gfxIndex);
      if (type === undefined) throw new Error(`no fallback wall record ${gfxIndex}`);
      wall = systems.createPalisade(s.world, type, {
        x: WALL_AT.hx,
        y: WALL_AT.hy,
        tribe: PRIMARY_TRIBE,
        owner: HUMAN_PLAYER,
        underConstruction,
      });
      if (wall === null) throw new Error('the wall did not stand');
      if (scale === 'valency') {
        s.world.mut(wall, Palisade).repairPerStrike /= WALL_HITPOINTS_PER_VALENCY;
        const health = s.world.mut(wall, Health);
        health.max /= WALL_HITPOINTS_PER_VALENCY;
        health.hitpoints = Math.min(health.hitpoints, health.max);
      }
      spawnSandboxSettlerDirect(s, JOB_BUILDER, BUILDER_AT.x, BUILDER_AT.y, HUMAN_PLAYER);
    },
  });
  if (wall === null) throw new Error('the wall did not stand');
  return [sim, wall];
}

/** Builder strikes that raise a wall site whose wood is in. */
function strikesToBuild(scale: Scale): number {
  const [sim, wall] = wallWithBuilder(PALISADE_WALL_GFX_INDEX, scale, true);
  sim.world.mut(wall, Stockpile).amounts.set(GOOD_WOOD, 1);
  let strikes = 0;
  for (let tick = 0; tick < MAX_TICKS && sim.world.has(wall, UnderConstruction); tick++) {
    const before = sim.world.get(wall, UnderConstruction).labor;
    sim.step();
    const site = sim.world.tryGet(wall, UnderConstruction);
    if (site === undefined || site.labor > before) strikes++;
  }
  expect(sim.world.has(wall, UnderConstruction)).toBe(false);
  return strikes;
}

/** Builder strikes that mend a wall from one valency point left to whole. */
function strikesToRepair(gfxIndex: number, scale: Scale): number {
  const [sim, wall] = wallWithBuilder(gfxIndex, scale, false);
  sim.world.mut(wall, Health).hitpoints = scale === 'valency' ? 1 : WALL_HITPOINTS_PER_VALENCY;
  sim.world.add(wall, Damaged, { lastHitTick: null });
  let strikes = 0;
  const health = () => sim.world.get(wall, Health);
  for (let tick = 0; tick < MAX_TICKS && health().hitpoints < health().max; tick++) {
    const before = health().hitpoints;
    sim.step();
    if (health().hitpoints > before) strikes++;
  }
  expect(health().hitpoints).toBe(health().max);
  return strikes;
}

describe('wall hitpoints per valency point', () => {
  it('leave the strikes to raise a post as they were on the valency scale', () => {
    expect(strikesToBuild('valency')).toBe(POST_BUILD_STRIKES);
    expect(strikesToBuild('hitpoints')).toBe(POST_BUILD_STRIKES);
  });

  it('leave the strikes to mend a post and a gate as they were on the valency scale', () => {
    const post = strikesToRepair(PALISADE_WALL_GFX_INDEX, 'hitpoints');
    const gate = strikesToRepair(PALISADE_HORIZONTAL_GATE_CLOSED_GFX_INDEX, 'hitpoints');
    expect([post, gate]).toEqual([
      strikesToRepair(PALISADE_WALL_GFX_INDEX, 'valency'),
      strikesToRepair(PALISADE_HORIZONTAL_GATE_CLOSED_GFX_INDEX, 'valency'),
    ]);
    expect([post, gate]).toEqual([POST_REPAIR_STRIKES, GATE_REPAIR_STRIKES]);
  });
});
