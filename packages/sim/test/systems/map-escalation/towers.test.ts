import { MapEscalation } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Building, JobAssignment, Owner, Settler } from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { Simulation } from '../../../src/index.js';
import { placeBuilding } from '../../../src/systems/command/placement.js';
import { removeBuildingSilently } from '../../../src/systems/lifecycle/cleanup.js';
import { reap } from '../../../src/systems/lifecycle/death.js';
import { aiContent } from '../../fixtures/ai-content.js';
import { ctxOf } from '../../fixtures/context.js';
import {
  BOWMAN,
  ESCALATION,
  FORTRESS,
  HQ_TYPE,
  KEEP,
  MAP,
  REFILL_EVERY_SECONDS,
  runToSecond,
  SCRIPT,
  VIKING,
} from '../../fixtures/map-escalation/keep.js';
import { grassNodeMap } from '../../fixtures/terrain.js';

/** The fixture's tower, with four short-bow posts. */
const TOWER_TYPE = 15;
const TOWER_POSTS = 4;
const TOWER = { x: KEEP.x + 16, y: KEEP.y };
/** More than the tower's posts, so the posts cap it. */
const WANTED_ARCHERS = 6;

function towerWorld(): Simulation {
  const sim = new Simulation({
    seed: 3,
    content: aiContent(),
    map: grassNodeMap(MAP, MAP),
    mapAiScript: SCRIPT,
    mapEscalation: MapEscalation.parse({
      ...ESCALATION,
      towerGarrison: { slots: [{ job: BOWMAN, count: WANTED_ARCHERS }] },
    }),
  });
  // The fortress is the map AI's alone, as a map's scripted seat is.
  sim.enqueueSetup({ kind: 'setAiControl', player: FORTRESS, enabled: true, computerEnabled: false });
  const house = (buildingType: number, at: { x: number; y: number }) =>
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType,
      ...at,
      tribe: VIKING,
      owner: FORTRESS,
      force: true,
      underConstruction: false,
    });
  house(HQ_TYPE, KEEP);
  house(TOWER_TYPE, TOWER);
  sim.step();
  return sim;
}

function towerOf(sim: Simulation): Entity {
  const tower = [...sim.world.query(Building, Owner)].find(
    (e) =>
      sim.world.get(e, Owner).player === FORTRESS && sim.world.get(e, Building).buildingType === TOWER_TYPE,
  );
  if (tower === undefined) throw new Error('no tower');
  return tower;
}

function postedTo(sim: Simulation, tower: Entity): Entity[] {
  return [...sim.world.query(Settler, JobAssignment)].filter(
    (e) =>
      sim.world.get(e, JobAssignment).workplace === tower && sim.world.get(e, Settler).jobType === BOWMAN,
  );
}

describe('map escalation - tower garrison', () => {
  it('mans a tower to its posts, keeps the men on it, replaces a lost one and mans a tower raised again', () => {
    const sim = towerWorld();
    const tower = towerOf(sim);
    runToSecond(sim, REFILL_EVERY_SECONDS);
    const first = postedTo(sim, tower);
    expect(first).toHaveLength(TOWER_POSTS);

    // Calm beats later the program still keeps them all on the wall.
    runToSecond(sim, 4 * REFILL_EVERY_SECONDS - 1);
    expect(postedTo(sim, tower)).toEqual(first);

    const [lost] = first;
    if (lost === undefined) throw new Error('no archer');
    reap(sim.world, ctxOf(sim), lost);
    runToSecond(sim, 5 * REFILL_EVERY_SECONDS);
    const now = postedTo(sim, tower);
    expect(now).toHaveLength(TOWER_POSTS);
    expect(now).not.toContain(lost);

    removeBuildingSilently(sim.world, ctxOf(sim), tower);
    placeBuilding(
      sim.world,
      ctxOf(sim),
      {
        kind: 'placeBuilding',
        buildingType: TOWER_TYPE,
        ...TOWER,
        tribe: VIKING,
        owner: FORTRESS,
        force: true,
        underConstruction: false,
      },
      false,
    );
    const raised = towerOf(sim);
    runToSecond(sim, 6 * REFILL_EVERY_SECONDS);
    expect(postedTo(sim, raised)).toHaveLength(TOWER_POSTS);
  });
});
