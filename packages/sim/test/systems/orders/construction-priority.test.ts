import { describe, expect, it } from 'vitest';
import { UnderConstruction } from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { fx, Simulation } from '../../../src/index.js';
import {
  builtBuildingAt,
  constructionContent,
  grassMap,
  HOUSE,
  placeSite,
} from '../economy/construction/system/support.js';

function sim(): Simulation {
  return new Simulation({ seed: 1, content: constructionContent(), map: grassMap(16, 4) });
}

function setPriority(world: Simulation, site: Entity, prioritized: boolean): void {
  world.enqueueSetup({ kind: 'setConstructionPriority', building: site, prioritized });
  world.step();
}

describe('setConstructionPriority', () => {
  it('marks the site, and unmarking clears it', () => {
    const world = sim();
    const site = placeSite(world, HOUSE);
    setPriority(world, site, true);
    expect(world.world.tryGet(site, UnderConstruction)?.prioritized).toBe(true);
    setPriority(world, site, false);
    expect(world.world.tryGet(site, UnderConstruction)?.prioritized).toBeUndefined();
  });

  it('refuses a standing building, so no finished house keeps a rank', () => {
    const world = sim();
    const house = builtBuildingAt(world, HOUSE, 6, 1);
    setPriority(world, house, true);
    expect(world.world.has(house, UnderConstruction)).toBe(false);
  });

  it('refuses a site without a building, so walls and road sites never rank', () => {
    const world = sim();
    const bare = world.world.create();
    world.world.add(bare, UnderConstruction, { labor: fx.fromInt(0) });
    setPriority(world, bare, true);
    expect(world.world.tryGet(bare, UnderConstruction)?.prioritized).toBeUndefined();
  });
});
