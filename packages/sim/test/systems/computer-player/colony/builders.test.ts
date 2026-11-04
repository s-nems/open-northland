import { describe, expect, it } from 'vitest';
import { Building } from '../../../../src/components/index.js';
import {
  colonyBuilderWant,
  withBuilderPosts,
} from '../../../../src/systems/computer-player/colony/builders.js';
import { ctxOf } from '../../../fixtures/context.js';
import { aiSim, HOME_TYPE, SEAT, VIKING } from '../support.js';

const B = 'builder';
/** The builders one open site takes. */
const PAIR = 2;
const POSTS = [B, 'fisher', B, 'wood', B] as const;
const SITES = [
  { x: 20, y: 20 },
  { x: 30, y: 20 },
];

describe("a colony's builder posts", () => {
  it('keep the first ones in place and drop the tail past the sites crew', () => {
    expect(withBuilderPosts(POSTS, B, PAIR)).toEqual([B, 'fisher', B, 'wood']);
  });

  it('add the builders more sites call for at the end', () => {
    expect(withBuilderPosts(POSTS, B, 5)).toEqual([...POSTS, B, B]);
  });
});

describe("a colony's builder crew", () => {
  it('is a pair per open site and a pair for the next while more is planned, never under a pair', () => {
    const sim = aiSim();
    for (const site of SITES)
      sim.enqueueSetup({
        kind: 'placeBuilding',
        buildingType: HOME_TYPE,
        ...site,
        tribe: VIKING,
        owner: SEAT,
        force: true,
        underConstruction: true,
      });
    sim.step();
    const sites = [...sim.world.query(Building)];
    const ctx = ctxOf(sim);
    expect(sites.length).toBe(SITES.length);
    expect(colonyBuilderWant(sim.world, ctx, [], 0)).toBe(PAIR);
    expect(colonyBuilderWant(sim.world, ctx, [], 1)).toBe(PAIR);
    expect(colonyBuilderWant(sim.world, ctx, sites, 0)).toBe(SITES.length * PAIR);
    expect(colonyBuilderWant(sim.world, ctx, sites, 1)).toBe((SITES.length + 1) * PAIR);
  });
});
