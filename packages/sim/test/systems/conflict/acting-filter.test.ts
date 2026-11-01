import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  Building,
  Health,
  isValidPlayer,
  MoveGoal,
  Owner,
  PlayerOrder,
  Position,
  Settler,
  Stance,
  Stranded,
  setDiplomacyStance,
  setSettlerJob,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { cellAnchorNode, fx, ONE, Simulation } from '../../../src/index.js';
import type { TerrainGraph } from '../../../src/nav/terrain/index.js';
import { mayEngage } from '../../../src/systems/conflict/acting.js';
import { BattleFront } from '../../../src/systems/conflict/battle-alert.js';
import { CombatIndex } from '../../../src/systems/conflict/combat-index.js';
import { engageCandidates } from '../../../src/systems/conflict/engage-candidates.js';
import { engageCombatant } from '../../../src/systems/conflict/engage-combatant.js';
import { MeleeSlots } from '../../../src/systems/conflict/melee-slots.js';
import type { CombatPass } from '../../../src/systems/conflict/pass.js';
import { isManningPost, TOWER_RANGE_BONUS_NODES } from '../../../src/systems/conflict/tower-post.js';
import { attackMoveUnit } from '../../../src/systems/orders/index.js';
import { MILITARY_MODE } from '../../../src/systems/readviews/index.js';
import { entityNode } from '../../../src/systems/spatial/nodes.js';
import { testContent } from '../../fixtures/content.js';
import { BEAR, BOAR, COW, DEER, fighterAtNode, HUNTER } from './combat-system/support.js';
import { cell, combatantAtNode, ctxOf, grassMap, P0, P1 } from './stances/support.js';

const TICKS = 120;
/** Long enough that the soldiers' walk up to their towers is the smaller part of the run. */
const POST_TICKS = 240;

/** Two warring villages that meet, a far quiet one, guards, a hunter and wildlife. */
function mixedScene(): Simulation {
  const sim = new Simulation({ seed: 7, content: testContent(), map: grassMap(64, 64) });
  setDiplomacyStance(sim.world, P0, P1, 'enemy');
  setDiplomacyStance(sim.world, P1, P0, 'enemy');
  for (let i = 0; i < 4; i++) {
    combatantAtNode(sim, 20 + 2 * i, 20, P0, MILITARY_MODE.ATTACK);
    combatantAtNode(sim, 20 + 2 * i, 24, P0, MILITARY_MODE.FLEE);
    combatantAtNode(sim, 44 + 2 * i, 20, P1, MILITARY_MODE.ATTACK);
    combatantAtNode(sim, 44 + 2 * i, 26, P1, MILITARY_MODE.IGNORE);
    // Far from any enemy: the filter should skip this village until the fight comes near.
    combatantAtNode(sim, 20 + 2 * i, 100, P0, MILITARY_MODE.FLEE);
    combatantAtNode(sim, 20 + 2 * i, 104, P0, MILITARY_MODE.ATTACK);
  }
  combatantAtNode(sim, 30, 104, P0, MILITARY_MODE.DEFEND); // on its own anchor
  const offAnchor = combatantAtNode(sim, 34, 104, P0, MILITARY_MODE.DEFEND);
  sim.world.mut(offAnchor, Stance).anchorCell = cell(sim, 10, 25);
  // A civilian walking to work past the enemy line, whom only a blow would turn.
  const walker = combatantAtNode(sim, 30, 40, P0, MILITARY_MODE.FLEE);
  sim.world.add(walker, MoveGoal, { cell: cell(sim, 30, 20) });
  const stranded = combatantAtNode(sim, 38, 104, P0, MILITARY_MODE.DEFEND);
  sim.world.add(stranded, Stranded, { retryAt: 0 });
  combatantAtNode(sim, 100, 100, P1, MILITARY_MODE.IGNORE, { jobType: HUNTER });
  fighterAtNode(sim, 106, 100, DEER, null);
  fighterAtNode(sim, 100, 40, BEAR, null);
  fighterAtNode(sim, 60, 100, COW, null);
  fighterAtNode(sim, 64, 100, BOAR, null);
  return sim;
}

const VIKING = 1;
const SOLDIER_JOB = 31;
const TOWER_TYPE = 92;
const BOW_TYPE = 20;
const ARROW_MUNITION = 1;
/** A bow whose tower reach passes the sight radius, so only the post's own reach covers its search. */
const POST_BOW_RANGE = 30;
const POST_BOW_MIN_RANGE = 2;
const TOWER_HITPOINTS = 1_000_000;

/** The fixture content with a tower posting the soldier class, armed with {@link POST_BOW_RANGE}. */
function postContent(): ContentSet {
  const base = testContent();
  return parseContentSet({
    ...base,
    buildings: [
      ...base.buildings,
      {
        typeId: TOWER_TYPE,
        id: 'tower',
        kind: 'tower',
        workers: [{ jobType: SOLDIER_JOB, count: 1 }],
        footprint: { blocked: [{ dx: 0, dy: 0 }], door: { dx: 2, dy: 0 } },
      },
    ],
    weapons: [
      ...base.weapons,
      {
        typeId: BOW_TYPE,
        id: 'test_post_bow',
        tribeType: VIKING,
        jobType: SOLDIER_JOB,
        munitionType: ARROW_MUNITION,
        speed: 8,
        minRange: POST_BOW_MIN_RANGE,
        maxRange: POST_BOW_RANGE,
        damage: { '0': 40 },
      },
    ],
  });
}

/** A P0 tower at visual cell (x, y) with a soldier sent to man it. */
function mannedTower(sim: Simulation, x: number, y: number): Entity {
  const tower = sim.world.create();
  sim.world.add(tower, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(tower, Building, { buildingType: TOWER_TYPE, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(tower, Health, { hitpoints: TOWER_HITPOINTS, max: TOWER_HITPOINTS });
  sim.world.add(tower, Owner, { player: P0 });
  const n = cellAnchorNode(x - 2, y);
  const soldier = combatantAtNode(sim, n.hx, n.hy, P0, MILITARY_MODE.DEFEND, { jobType: SOLDIER_JOB });
  sim.enqueueSetup({ kind: 'assignWorker', entity: soldier, building: tower, jobPriority: [SOLDIER_JOB] });
  return soldier;
}

/** Order `e` to fight its way to visual cell (x, y). */
function marchTo(sim: Simulation, e: Entity, x: number, y: number): void {
  const n = cellAnchorNode(x, y);
  attackMoveUnit(sim.world, ctxOf(sim), { kind: 'attackMoveUnit', entity: e, x: n.hx, y: n.hy });
}

/** A manned tower an enemy column marches past bystanders toward, a quiet manned tower and a quiet march
 *  far off. */
function postsAndMarches(): { sim: Simulation; soldiers: readonly Entity[] } {
  const sim = new Simulation({ seed: 7, content: postContent(), map: grassMap(64, 64) });
  setDiplomacyStance(sim.world, P0, P1, 'enemy');
  setDiplomacyStance(sim.world, P1, P0, 'enemy');
  const soldiers = [mannedTower(sim, 20, 20), mannedTower(sim, 50, 50)];
  for (let i = 0; i < 3; i++) {
    const n = cellAnchorNode(45, 18 + 2 * i);
    marchTo(sim, combatantAtNode(sim, n.hx, n.hy, P1, MILITARY_MODE.ATTACK), 5, 18 + 2 * i);
  }
  // Bystanders beside the column's road, which it acquires on the walk.
  for (let i = 0; i < 2; i++) {
    const n = cellAnchorNode(36 + 2 * i, 26);
    combatantAtNode(sim, n.hx, n.hy, P0, MILITARY_MODE.IGNORE);
  }
  const far = cellAnchorNode(5, 58);
  marchTo(sim, combatantAtNode(sim, far.hx, far.hy, P0, MILITARY_MODE.DEFEND), 30, 58);
  return { sim, soldiers };
}

/** Every combatant the filter skips this tick, run through the ladder on a freshly built pass. */
function skippedLeaveNoTrace(sim: Simulation): number {
  const ctx = ctxOf(sim);
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('the scene has a map');
  const combatants = sim.world.canonicalQuery(Settler, Health, Position);
  const pass: CombatPass = {
    index: new CombatIndex(sim.world, ctx, terrain),
    slots: new MeleeSlots(sim.world, ctx, terrain),
    front: new BattleFront(sim.world, ctx),
    stance: { owned: false, ordered: false, mode: null, post: null },
  };
  const skipped: Entity[] = combatants.filter((e) => !mayEngage(sim.world, ctx, terrain, pass.index, e));
  const before = sim.hashState();
  for (const e of skipped) engageCombatant(sim.world, ctx, terrain, pass, e);
  expect(sim.hashState()).toBe(before);
  return skipped.length;
}

/** Whether `soldier` stands manning its post now: on the tower and still entitled to it. */
function onPost(sim: Simulation, soldier: Entity): boolean {
  return isManningPost(sim.world, ctxOf(sim), soldier);
}

/** How the owned candidates the index did not list near a stranger answered: the filter's skip path. */
interface FarAnswers {
  acted: number;
  refused: number;
}

/** Every combatant left out of this tick's candidates, each refused by the filter on a freshly built pass;
 *  every candidate answered alike with and without the index's near-stranger listing, the unlisted owned
 *  ones tallied into `far`. */
function outsideCandidatesRefused(sim: Simulation, far: FarAnswers = { acted: 0, refused: 0 }): number {
  const ctx = ctxOf(sim);
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('the scene has a map');
  const index = new CombatIndex(sim.world, ctx, terrain);
  const ready = engageCandidates(sim.world, ctx, index);
  const candidates = new Set<Entity>();
  for (let i = 0; i < ready.count; i++) candidates.add(ready.candidateAt(i));
  let outside = 0;
  for (const e of sim.world.canonicalQuery(Settler, Health, Position)) {
    if (candidates.has(e)) {
      const answer = mayEngage(sim.world, ctx, terrain, index, e);
      expect(mayEngage(sim.world, ctx, terrain, index, e, ready.nearStranger(e))).toBe(answer);
      const owner = sim.world.tryGet(e, Owner);
      if (!ready.nearStranger(e) && owner !== undefined && isValidPlayer(owner.player)) {
        if (answer) far.acted++;
        else far.refused++;
      }
      continue;
    }
    outside++;
    expect(mayEngage(sim.world, ctx, terrain, index, e)).toBe(false);
  }
  return outside;
}

/** Three quiet villagers far from the fight, whose readiness the run flips in place halfway through. */
function quietRecruits(sim: Simulation): () => void {
  const recruit = combatantAtNode(sim, 40, 110, P0, MILITARY_MODE.FLEE);
  const guard = combatantAtNode(sim, 44, 110, P0, MILITARY_MODE.DEFEND);
  const marcher = combatantAtNode(sim, 48, 110, P0, MILITARY_MODE.ATTACK);
  // A plain move order benches it; its long walk keeps the order alive until the attack-move is written.
  sim.world.add(marcher, PlayerOrder, {});
  sim.world.add(marcher, MoveGoal, { cell: cell(sim, 60, 10) });
  return () => {
    setSettlerJob(sim.world, recruit, HUNTER);
    sim.world.mut(guard, Stance).anchorCell = cell(sim, 10, 25);
    sim.world.mut(marcher, PlayerOrder).attackMove = {
      goal: cell(sim, 20, 50),
      resume: false,
      blockedUntil: 0,
    };
  };
}

describe('combat pass - who may engage', () => {
  it('draws every combatant the filter lets act among the candidates, and leaves the quiet ones out', () => {
    const sim = mixedScene();
    const stir = quietRecruits(sim);
    // A guard standing on its anchor stays ready, so it is drawn far from any stranger and refused there.
    const settled = combatantAtNode(sim, 52, 110, P0, MILITARY_MODE.DEFEND);
    sim.world.mut(settled, Stance).anchorCell = entityNode(sim.world, terrainOf(sim), settled);
    let outside = 0;
    const far: FarAnswers = { acted: 0, refused: 0 };
    for (let t = 0; t < TICKS; t++) {
      if (t === TICKS / 2) stir();
      outside += outsideCandidatesRefused(sim, far);
      sim.step();
      expect(sim.world.verifyCaches()).toEqual([]);
    }
    expect(outside).toBeGreaterThan(TICKS); // the quiet village and the grazing herd are never drawn
    expect(far.acted).toBeGreaterThan(0); // the far guard walking back to its moved anchor
    expect(far.refused).toBeGreaterThan(0);
  });

  it('the verifiers flag a readiness or a position written around the tracked seams', () => {
    const sim = mixedScene();
    const guard = combatantAtNode(sim, 44, 110, P0, MILITARY_MODE.DEFEND);
    outsideCandidatesRefused(sim);
    expect(sim.world.verifyCaches()).toEqual([]);
    // Defeating the readonly views is the bug the verifiers exist to catch: no feed entry.
    (sim.world.get(guard, Stance) as { anchorCell: number | null }).anchorCell = cell(sim, 10, 25);
    (sim.world.get(guard, Position) as { x: number }).x = sim.world.get(guard, Position).x + 20 * ONE;
    const reports = sim.world.verifyCaches().join('\n');
    expect(reports).toContain('combatReadyUnits');
    expect(reports).toContain('combatUnitLayer');
  });

  it('skips only combatants the engage ladder would leave untouched', () => {
    const sim = mixedScene();
    let skipped = 0;
    for (let t = 0; t < TICKS; t++) {
      skipped += skippedLeaveNoTrace(sim);
      sim.step();
    }
    expect(skipped).toBeGreaterThan(TICKS); // the quiet village and the grazing herd are skipped
  });

  it('gates a manned post and an attack-move by presence at the tower reach and sight', () => {
    expect(POST_BOW_RANGE + TOWER_RANGE_BONUS_NODES).toBeGreaterThan(18); // past the sight radius
    const { sim, soldiers } = postsAndMarches();
    let skipped = 0;
    let manned = 0;
    for (let t = 0; t < POST_TICKS; t++) {
      skipped += skippedLeaveNoTrace(sim);
      outsideCandidatesRefused(sim);
      sim.step();
      expect(sim.world.verifyCaches()).toEqual([]);
      for (const soldier of soldiers) if (onPost(sim, soldier)) manned++;
    }
    expect(manned).toBeGreaterThan(POST_TICKS); // both towers were held for most of the run
    expect(skipped).toBeGreaterThan(POST_TICKS); // the quiet post and the far march are skipped
  });
});

function terrainOf(sim: Simulation): TerrainGraph {
  if (sim.terrain === undefined) throw new Error('the scene has a map');
  return sim.terrain;
}
