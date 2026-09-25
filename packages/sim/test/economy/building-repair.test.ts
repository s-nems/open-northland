import { describe, expect, it } from 'vitest';
import {
  CurrentAtomic,
  Damaged,
  Engagement,
  Health,
  Owner,
  Position,
  SiteAssignment,
  Stockpile,
  Upgrading,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, Simulation } from '../../src/index.js';
import { forceFinishConstruction } from '../../src/systems/economy/construction.js';
import { needsRepair, REPAIR_CREW_LIMIT, repairBuilding } from '../../src/systems/economy/repair.js';
import { plannerSystem } from '../../src/systems/index.js';
import { resolveCombatHit } from '../../src/systems/settlers/atomics/effects/combat/hit/resolution.js';
import { REPAIR_CALM_TICKS } from '../../src/systems/settlers/drives/economy/repair.js';
import {
  builderAt,
  builtBuildingAt,
  constructionContent,
  ctxOf,
  grassMap,
  HOUSE,
  STONE,
  siteAt,
  WOOD,
} from './construction-system/support.js';

const DAMAGED_MAX_HP = 1000;

/** A standing house at `(x, y)` with `hitpoints` of {@link DAMAGED_MAX_HP}, last hit on `lastHitTick`. */
function damagedHouseAt(
  sim: Simulation,
  x: number,
  y: number,
  hitpoints: number,
  lastHitTick = -REPAIR_CALM_TICKS,
): Entity {
  const house = builtBuildingAt(sim, HOUSE, x, y);
  sim.world.add(house, Health, { hitpoints, max: DAMAGED_MAX_HP });
  sim.world.add(house, Damaged, { lastHitTick });
  return house;
}

function repairSite(sim: Simulation, builder: Entity): Entity | undefined {
  return sim.world.tryGet(builder, SiteAssignment)?.site;
}

/** Step until `builder` joins the crew at `site`, bounded by an idle builder's re-plan wait. */
function stepUntilCrew(sim: Simulation, builder: Entity, site: Entity): Entity | undefined {
  for (let i = 0; i < 200 && repairSite(sim, builder) !== site; i++) sim.step();
  return repairSite(sim, builder);
}

describe('building repair', () => {
  it('a builder mends a damaged building back to its max with no material', () => {
    const sim = new Simulation({ seed: 1, content: constructionContent(), map: grassMap(10, 3) });
    const house = damagedHouseAt(sim, 6, 1, 300);
    const builder = builderAt(sim, 1, 1);

    let swung = false;
    for (let i = 0; i < 4000 && sim.world.has(house, Damaged); i++) {
      sim.step();
      swung ||= sim.world.tryGet(builder, CurrentAtomic)?.effect.kind === 'repair';
    }

    expect(swung).toBe(true);
    expect(sim.world.get(house, Health).hitpoints).toBe(DAMAGED_MAX_HP);
    expect(sim.world.has(house, Damaged)).toBe(false);
    expect(sim.world.get(house, Stockpile).amounts.size).toBe(0);
  });

  it('a novice bare-handed swing restores one step of 100 hitpoints', () => {
    const sim = new Simulation({ seed: 2, content: constructionContent(), map: grassMap(10, 3) });
    const house = damagedHouseAt(sim, 6, 1, 300);
    const builder = builderAt(sim, 5, 1);

    expect(repairBuilding(sim.world, ctxOf(sim), house, builder)).toBe(true);
    expect(sim.world.get(house, Health).hitpoints).toBe(400);
  });

  it('sends no crew to a building hit within the calm period', () => {
    const sim = new Simulation({ seed: 3, content: constructionContent(), map: grassMap(10, 3) });
    const house = damagedHouseAt(sim, 6, 1, 300, sim.tick - REPAIR_CALM_TICKS + 1);
    const builder = builderAt(sim, 1, 1);

    plannerSystem(sim.world, ctxOf(sim));
    expect(repairSite(sim, builder)).not.toBe(house);

    sim.world.mut(house, Damaged).lastHitTick = sim.tick - REPAIR_CALM_TICKS;
    expect(stepUntilCrew(sim, builder, house)).toBe(house);
  });

  it('sends no crew to a building while a fight is on beside it', () => {
    const sim = new Simulation({ seed: 4, content: constructionContent(), map: grassMap(10, 3) });
    const house = damagedHouseAt(sim, 6, 1, 300);
    const builder = builderAt(sim, 1, 1);
    const fighter = sim.world.create();
    sim.world.add(fighter, Position, { x: fx.fromInt(8), y: fx.fromInt(1) });
    sim.world.add(fighter, Engagement, { repathAt: 0 });

    plannerSystem(sim.world, ctxOf(sim));
    expect(repairSite(sim, builder)).not.toBe(house);

    sim.world.remove(fighter, Engagement);
    expect(stepUntilCrew(sim, builder, house)).toBe(house);
  });

  it('caps a repair crew at the original five builders', () => {
    const sim = new Simulation({ seed: 5, content: constructionContent(), map: grassMap(14, 5) });
    const house = damagedHouseAt(sim, 7, 2, 100);
    const builders = [1, 2, 3, 4, 10, 11, 12].map((x) => builderAt(sim, x, 4));

    plannerSystem(sim.world, ctxOf(sim));

    expect(builders.filter((b) => repairSite(sim, b) === house)).toHaveLength(REPAIR_CREW_LIMIT);
  });

  it('ranks a safe repair ahead of a nearer construction site with its material on hand', () => {
    const sim = new Simulation({ seed: 6, content: constructionContent(), map: grassMap(12, 3) });
    const site = siteAt(sim, HOUSE, 2, 1);
    sim.world.mut(site, Stockpile).amounts.set(STONE, 2);
    sim.world.mut(site, Stockpile).amounts.set(WOOD, 1);
    const house = damagedHouseAt(sim, 9, 1, 300);
    const builder = builderAt(sim, 1, 1);

    plannerSystem(sim.world, ctxOf(sim));

    expect(repairSite(sim, builder)).toBe(house);
  });

  it('leaves a damaged upgrade site under attack to the repair crew, not the construction crew', () => {
    const sim = new Simulation({ seed: 10, content: constructionContent(), map: grassMap(10, 3) });
    const site = siteAt(sim, HOUSE, 6, 1);
    sim.world.mut(site, Stockpile).amounts.set(STONE, 2);
    sim.world.mut(site, Stockpile).amounts.set(WOOD, 1);
    sim.world.add(site, Upgrading, { savedStock: new Map(), seeded: new Map() });
    sim.world.add(site, Health, { hitpoints: 300, max: DAMAGED_MAX_HP });
    sim.world.add(site, Damaged, { lastHitTick: sim.tick });
    const builder = builderAt(sim, 5, 1);

    plannerSystem(sim.world, ctxOf(sim));

    expect(repairSite(sim, builder)).not.toBe(site);
    expect(sim.world.tryGet(builder, CurrentAtomic)?.effect.kind).not.toBe('construct');
  });

  it("a player's order sends a builder into a building hit this tick", () => {
    const sim = new Simulation({ seed: 7, content: constructionContent(), map: grassMap(10, 3) });
    const house = damagedHouseAt(sim, 6, 1, 300, sim.tick);
    const builder = builderAt(sim, 1, 1);
    sim.world.add(builder, Owner, { player: 0 });
    sim.enqueueSetup({ kind: 'assignBuilder', entity: builder, site: house });
    sim.step();
    expect(sim.world.get(builder, SiteAssignment)).toEqual({ site: house, pinned: true });

    for (let i = 0; i < 400 && sim.world.get(house, Health).hitpoints === 300; i++) sim.step();
    expect(sim.world.get(house, Health).hitpoints).toBeGreaterThan(300);
  });

  it('mends a damaged upgrade site but not a foundation still rising', () => {
    const sim = new Simulation({ seed: 8, content: constructionContent(), map: grassMap(10, 3) });
    const foundation = siteAt(sim, HOUSE, 2, 1);
    sim.world.add(foundation, Health, { hitpoints: 10, max: DAMAGED_MAX_HP });
    sim.world.add(foundation, Damaged, { lastHitTick: 0 });
    expect(needsRepair(sim.world, foundation)).toBe(false);

    sim.world.add(foundation, Upgrading, { savedStock: new Map(), seeded: new Map() });
    expect(needsRepair(sim.world, foundation)).toBe(true);
  });

  it('a landed blow marks the building, and a filled pool clears the mark', () => {
    const sim = new Simulation({ seed: 9, content: constructionContent(), map: grassMap(10, 3) });
    const site = siteAt(sim, HOUSE, 6, 1);
    sim.world.add(site, Health, { hitpoints: DAMAGED_MAX_HP, max: DAMAGED_MAX_HP });
    const attacker = builderAt(sim, 5, 1);

    resolveCombatHit(sim.world, ctxOf(sim), attacker, site, { damage: 50 }, [], 'melee');
    expect(sim.world.get(site, Damaged)).toEqual({ lastHitTick: sim.tick });

    forceFinishConstruction(sim.world, ctxOf(sim), site);
    expect(sim.world.has(site, Damaged)).toBe(false);
  });
});
