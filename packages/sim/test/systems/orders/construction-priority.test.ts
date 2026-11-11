import { describe, expect, it } from 'vitest';
import { UnderConstruction } from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { type ConstructionPriority, fx, Simulation } from '../../../src/index.js';
import {
  builtBuildingAt,
  constructionContent,
  grassMap,
  HOUSE,
  placeSite,
} from '../economy/construction/system/support.js';

// The `setConstructionPriority` order: one construction site takes a build rank its owner's builders
// weigh ahead of the sites' standing; anything but a raised building site refuses.

function sim(): Simulation {
  return new Simulation({ seed: 1, content: constructionContent(), map: grassMap(16, 4) });
}

function setPriority(world: Simulation, site: Entity, priority: ConstructionPriority): void {
  world.enqueueSetup({ kind: 'setConstructionPriority', building: site, priority });
  world.step();
}

describe('setConstructionPriority', () => {
  it('carries the rank on the site, and `normal` clears it', () => {
    const world = sim();
    const site = placeSite(world, HOUSE);
    setPriority(world, site, 'high');
    expect(world.world.tryGet(site, UnderConstruction)?.priority).toBe('high');
    setPriority(world, site, 'normal');
    expect(world.world.tryGet(site, UnderConstruction)?.priority).toBeUndefined();
  });

  it('refuses a standing building, so no finished house keeps a rank', () => {
    const world = sim();
    const house = builtBuildingAt(world, HOUSE, 6, 1);
    setPriority(world, house, 'high');
    expect(world.world.has(house, UnderConstruction)).toBe(false);
  });

  it('refuses a site without a building, so walls and road sites never rank', () => {
    const world = sim();
    const bare = world.world.create();
    world.world.add(bare, UnderConstruction, { labor: fx.fromInt(0) });
    setPriority(world, bare, 'high');
    expect(world.world.tryGet(bare, UnderConstruction)?.priority).toBeUndefined();
  });
});
