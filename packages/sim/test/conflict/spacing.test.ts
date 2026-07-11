import { type ContentSet, IR_VERSION, parseContentSet } from '@vinland/data';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  Building,
  CurrentAtomic,
  MoveGoal,
  Owner,
  PathFollow,
  Position,
  Settler,
  Stockpile,
  UnderConstruction,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import {
  fx,
  halfCellMapFromCells,
  nodeOfPosition,
  positionOfNode,
  Simulation,
  type TerrainMap,
} from '../../src/index.js';
import { testContent } from '../fixtures/content.js';
import { clearComponentStores } from '../fixtures/stores.js';

/**
 * Tests for the IDLE-SPACING (de-stack) drive: owned settlers don't HARD-collide (a walker passes freely
 * through any half-cell node) but they won't come to REST stacked on top of one another — a unit that has
 * arrived with nothing to do and shares its node with a lower-id resting owned unit steps off to the
 * nearest free NODE (half a cell — a 34 or 19 px hop). Faithful in spirit to the original's per-cell
 * valency (source basis). Gated on Owner, so the unowned golden/economy fixtures never de-stack (their
 * planner output stays byte-identical). All scenario coordinates here are node coords.
 */

const GRASS = 0;
const VIKING = 1;
const WOODCUTTER = 1;
const HUMAN_PLAYER = 0;

beforeEach(clearComponentStores);

function grassMap(width: number, height: number): TerrainMap {
  // Cell-dims signature; the sim's graph is the upsampled 2W×2H half-cell lattice.
  return halfCellMapFromCells({ width, height, typeIds: new Array(width * height).fill(GRASS) });
}

function sim(): Simulation {
  return new Simulation({ seed: 1, content: testContent(), map: grassMap(12, 6) });
}

/** A settler of the given trade at half-cell NODE (x,y) — the one factory both drives' tests share. */
function settlerAt(s: Simulation, x: number, y: number, jobType: number, owner: number | null): Entity {
  const e = s.world.create();
  s.world.add(e, Position, positionOfNode(x, y));
  s.world.add(e, Settler, {
    tribe: VIKING,
    jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map(),
  });
  if (owner !== null) s.world.add(e, Owner, { player: owner });
  return e;
}

/** An idle OWNED viking woodcutter (no job binding, so with no resources nearby it has nothing to do). */
function idleWoodcutter(s: Simulation, x: number, y: number, owner: number | null = HUMAN_PLAYER): Entity {
  return settlerAt(s, x, y, WOODCUTTER, owner);
}

/** The half-cell node an entity stands on. */
function tileOf(s: Simulation, e: Entity): { x: number; y: number } {
  const p = s.world.get(e, Position);
  const n = nodeOfPosition(p.x, p.y);
  return { x: n.hx, y: n.hy };
}

describe('idle-spacing (de-stack) drive', () => {
  it('spreads two stacked idle owned settlers so they end on different nodes (lowest id keeps the node)', () => {
    const s = sim();
    const keeper = idleWoodcutter(s, 4, 3); // lower id — holds the node
    const mover = idleWoodcutter(s, 4, 3); // higher id — steps aside
    s.run(15); // one de-stack step (a half-cell node hop, a few move ticks) plus slack

    expect(tileOf(s, keeper)).toEqual({ x: 4, y: 3 }); // the keeper never moved
    const m = tileOf(s, mover);
    expect(m.x === 4 && m.y === 3).toBe(false); // the mover left the shared node
    expect(Math.abs(m.x - 4) + Math.abs(m.y - 3)).toBe(1); // to an adjacent free node (half a cell away)
  });

  it('settles to a stable, non-stacked configuration (no endless churn)', () => {
    const s = sim();
    const a = idleWoodcutter(s, 4, 3);
    const b = idleWoodcutter(s, 4, 3);
    const c = idleWoodcutter(s, 4, 3);
    s.run(40); // long enough to spread AND prove it stops moving afterwards

    const tiles = [a, b, c].map((e) => tileOf(s, e));
    const keys = new Set(tiles.map((t) => `${t.x},${t.y}`));
    expect(keys.size).toBe(3); // all three on distinct nodes
    for (const e of [a, b, c]) {
      expect(s.world.has(e, MoveGoal)).toBe(false); // arrived — no lingering order
      expect(s.world.has(e, PathFollow)).toBe(false); // and not still walking (churn would show here)
    }
  });

  it('does NOT de-stack UNOWNED settlers — the Owner gate keeps neutral/golden fixtures byte-identical', () => {
    const s = sim();
    const a = idleWoodcutter(s, 4, 3, null); // no Owner
    const b = idleWoodcutter(s, 4, 3, null);
    s.run(15);

    expect(tileOf(s, a)).toEqual({ x: 4, y: 3 });
    expect(tileOf(s, b)).toEqual({ x: 4, y: 3 }); // both still stacked — no spacing applied
    expect(s.world.has(b, MoveGoal)).toBe(false);
  });

  it('never de-stacks an unowned settler sharing a tile with TWO owned units (the owner gate is real)', () => {
    // The tricky case: occupancy holds only OWNED units, so an unowned e is never its own tile's keeper —
    // without the explicit Owner guard it would slip past the `bucket[0] === e` check and wrongly move.
    const s = sim();
    const o1 = idleWoodcutter(s, 4, 3); // owned — keeper (lowest id)
    const o2 = idleWoodcutter(s, 4, 3); // owned — steps aside
    const neutral = idleWoodcutter(s, 4, 3, null); // unowned — MUST stay put
    s.run(20);

    expect(tileOf(s, neutral)).toEqual({ x: 4, y: 3 }); // the neutral never moved
    expect(s.world.has(neutral, MoveGoal)).toBe(false);
    // ...and the owned pair still spaced out around it (spacing keeps working for the owned units).
    expect(tileOf(s, o1)).toEqual({ x: 4, y: 3 });
    expect(tileOf(s, o2)).not.toEqual({ x: 4, y: 3 });
  });

  it('leaves a lone idle owned settler exactly where it stands', () => {
    const s = sim();
    const e = idleWoodcutter(s, 4, 3);
    s.run(15);
    expect(tileOf(s, e)).toEqual({ x: 4, y: 3 });
    expect(s.world.has(e, MoveGoal)).toBe(false);
  });
});

// ————————————————————————————————————————————————————————————————————————————————————————————————
// Builder WORK SLOTS (claimWorkCell): a crew on one construction site spreads over the site's yard
// instead of stacking on its one interaction cell. Body collision can never provide this — civilians
// are deliberate pass-through and the SeparationSystem displaces only WALKING movers — so the planner
// hands each builder a distinct stand cell (see systems/agents/destack.ts).
// ————————————————————————————————————————————————————————————————————————————————————————————————

const STONE = 2;
const WOOD = 3;
const HOUSE = 2;
const BUILDER = 7; // the builder trade (jobtypes.ini type 7); permitted to run the build-house atomic
const BUILD_HOUSE_ATOMIC = 39; // setatomic 7 39 "..._builder_build_house" (tribetypes.ini)

const WATER = 9; // walkable: false — the across-the-stream yard test's barrier

/** Content with a builder trade and a home whose cost is 2× stone + 1× wood (12 hammer swings), with
 *  a walk-blocking footprint and a named door — the interaction cell every builder converges on. */
function builderSiteContent(): ContentSet {
  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
    goods: [
      { typeId: 0, id: 'none' },
      { typeId: STONE, id: 'stone' },
      { typeId: WOOD, id: 'wood' },
    ],
    jobs: [
      { typeId: 0, id: 'idle' },
      { typeId: BUILDER, id: 'builder', allowedAtomics: [BUILD_HOUSE_ATOMIC] },
    ],
    landscape: [
      { typeId: GRASS, id: 'grass', walkable: true, buildable: true },
      { typeId: WATER, id: 'water', walkable: false, buildable: false },
    ],
    buildings: [
      {
        typeId: HOUSE,
        id: 'home_small',
        kind: 'home',
        homeSize: 2,
        construction: [
          { goodType: STONE, amount: 2 },
          { goodType: WOOD, amount: 1 },
        ],
        footprint: {
          blocked: [
            { dx: 0, dy: 0 },
            { dx: 2, dy: 0 },
          ],
          door: { dx: 0, dy: 2 },
        },
      },
    ],
  });
}

/** An under-construction site at half-cell NODE (x,y) with its FULL material cost already delivered,
 *  so builders hammer at once (labor trails the delivered fraction) and never leave to fetch. */
function stockedSiteAt(s: Simulation, x: number, y: number): Entity {
  const e = s.world.create();
  s.world.add(e, Position, positionOfNode(x, y));
  s.world.add(e, Building, { buildingType: HOUSE, tribe: VIKING, built: fx.fromInt(0), level: 0 });
  s.world.add(e, UnderConstruction, { labor: fx.fromInt(0) });
  s.world.add(e, Stockpile, {
    amounts: new Map<number, number>([
      [STONE, 2],
      [WOOD, 1],
    ]),
  });
  return e;
}

/** A builder at half-cell NODE (x,y) — owned by default (the work-slot spread is Owner-gated). */
function builderAt(s: Simulation, x: number, y: number, owner: number | null = HUMAN_PLAYER): Entity {
  return settlerAt(s, x, y, BUILDER, owner);
}

function builderSim(): Simulation {
  return new Simulation({ seed: 1, content: builderSiteContent(), map: grassMap(12, 6) });
}

describe('builder work slots (claimWorkCell)', () => {
  it('two owned builders on one site never run stacked build swings, and both do swing', () => {
    const s = builderSim();
    const site = stockedSiteAt(s, 12, 6);
    builderAt(s, 6, 6);
    builderAt(s, 6, 7);

    let stackedSwingTicks = 0;
    let parallelSwingTicks = 0;
    let finishedAt: number | null = null;
    for (let t = 0; t < 400 && finishedAt === null; t++) {
      s.step();
      const swinging = new Map<string, number>(); // node key → swing count
      for (const e of s.world.query(Settler, Position)) {
        if (s.world.has(e, PathFollow)) continue;
        if (s.world.tryGet(e, CurrentAtomic)?.atomicId !== BUILD_HOUSE_ATOMIC) continue;
        const n = tileOf(s, e);
        const key = `${n.x},${n.y}`;
        swinging.set(key, (swinging.get(key) ?? 0) + 1);
      }
      if ([...swinging.values()].some((count) => count >= 2)) stackedSwingTicks++;
      if (swinging.size >= 2) parallelSwingTicks++;
      if (!s.world.has(site, UnderConstruction)) finishedAt = t;
    }

    expect(stackedSwingTicks).toBe(0); // the regression: never two swings on one node
    expect(parallelSwingTicks).toBeGreaterThan(0); // the crew genuinely works in parallel, spread out
    expect(finishedAt).not.toBeNull(); // spreading the crew never stalls the build
  });

  it('a builder across a stream — in raw radius but unreachable — walks around instead of hammering from afar', () => {
    // Water cells (7, 1..4) → node columns 14–15, rows 2–9: a stream between the yard and the
    // builder, with open banks at node rows 0–1 and 10–11. The builder starts at (16,6) — Manhattan
    // 4 from the door (12,6) but NOT yard-reachable within 4 steps — so a raw-distance stay-put
    // rule would let it swing across the water forever; the yard-REGION rule must route it around
    // the stream and only let it hammer from a real yard cell.
    const ids = new Array<number>(12 * 6).fill(GRASS);
    for (let cy = 1; cy <= 4; cy++) ids[cy * 12 + 7] = WATER;
    const s = new Simulation({
      seed: 1,
      content: builderSiteContent(),
      map: halfCellMapFromCells({ width: 12, height: 6, typeIds: ids }),
    });
    stockedSiteAt(s, 12, 4); // door at anchor+(0,2) = (12,6), west of the stream
    const builder = builderAt(s, 16, 6); // east of the stream

    let swungAcrossTheStream = 0;
    let swungInYard = 0;
    for (let t = 0; t < 500; t++) {
      s.step();
      if (s.world.tryGet(builder, CurrentAtomic)?.atomicId !== BUILD_HOUSE_ATOMIC) continue;
      if (tileOf(s, builder).x >= 14) swungAcrossTheStream++;
      else swungInYard++;
    }
    expect(swungAcrossTheStream).toBe(0); // never hammers the site from across the water
    expect(swungInYard).toBeGreaterThan(0); // walked around the stream and worked from the yard
  });

  it('keeps UNOWNED builders on the shared interaction cell (the Owner gate — fixtures unchanged)', () => {
    const s = builderSim();
    stockedSiteAt(s, 12, 6);
    const a = builderAt(s, 6, 6, null);
    const b = builderAt(s, 6, 7, null);

    // The pre-slot shared-anchor behavior must survive for unowned fixtures: both hammer from
    // exactly the door node (12,6)+(0,2) — stacked swings and all.
    let stackedSwingTicks = 0;
    for (let t = 0; t < 120; t++) {
      s.step();
      if (
        s.world.tryGet(a, CurrentAtomic)?.atomicId === BUILD_HOUSE_ATOMIC &&
        s.world.tryGet(b, CurrentAtomic)?.atomicId === BUILD_HOUSE_ATOMIC &&
        tileOf(s, a).x === tileOf(s, b).x &&
        tileOf(s, a).y === tileOf(s, b).y
      ) {
        stackedSwingTicks++;
      }
    }
    expect(stackedSwingTicks).toBeGreaterThan(0); // no spread applied — the Owner gate is real
    expect(tileOf(s, a)).toEqual({ x: 12, y: 8 });
    expect(tileOf(s, b)).toEqual({ x: 12, y: 8 });
  });
});
