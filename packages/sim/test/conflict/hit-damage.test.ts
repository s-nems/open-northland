import { describe, expect, it } from 'vitest';
import {
  Building,
  Health,
  Position,
  WALK_DIRECTION,
  type WalkDirection,
  WalkFacing,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { Simulation } from '../../src/index.js';
import { HEX_HEADING, hexHeadingBetween, hexNeighboursOf, positionOfNode } from '../../src/nav/halfcell.js';
import { targetMaterial } from '../../src/systems/conflict/weapons.js';
import { ARMOR_MATERIAL } from '../../src/systems/index.js';
import { landedDamage } from '../../src/systems/settlers/atomics/effects/combat/hit/damage.js';
import {
  ARMOR_BLOCKING,
  CHAIN_CLASS,
  combatCadenceContent,
  ctxOf,
  fighterAtNode,
  grass,
  OTHER,
  VIKING,
  WOLF_TRIBE,
  WOMAN,
} from './combat-cadence/support.js';

// The victim stands on an even-row node; its six map-point neighbours, in `hexNeighboursOf` order.
const VICTIM = { hx: 4, hy: 4 } as const;
const [EAST, WEST, NORTH_WEST, NORTH_EAST, SOUTH_WEST, SOUTH_EAST] = hexNeighboursOf(VICTIM.hx, VICTIM.hy);
const BASE = 1000;

function setup(): { sim: Simulation; striker: Entity } {
  const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(6, 6) });
  return { sim, striker: fighterAtNode(sim, 0, 0, VIKING, WOMAN) };
}

function facing(sim: Simulation, e: Entity, direction: WalkDirection): void {
  sim.world.add(e, WalkFacing, { direction, target: direction });
}

function blowFrom(
  sim: Simulation,
  striker: Entity,
  victim: Entity,
  node: { hx: number; hy: number } | undefined,
) {
  if (node === undefined) throw new Error('missing neighbour');
  return landedDamage(sim.world, ctxOf(sim), striker, victim, BASE, positionOfNode(node.hx, node.hy));
}

describe('hexHeadingBetween - the map-point heading toward another node', () => {
  it('reads each neighbour as its own heading, the odd rows shifted half a node east', () => {
    const headings = hexNeighboursOf(VICTIM.hx, VICTIM.hy).map((n) =>
      hexHeadingBetween(VICTIM.hx, VICTIM.hy, n.hx, n.hy),
    );
    expect(headings).toEqual([
      HEX_HEADING.E,
      HEX_HEADING.W,
      HEX_HEADING.NW,
      HEX_HEADING.NE,
      HEX_HEADING.SW,
      HEX_HEADING.SE,
    ]);
  });

  it('reads straight north as NE, straight south as SW and the same node as E', () => {
    expect(hexHeadingBetween(4, 4, 4, 2)).toBe(HEX_HEADING.NE);
    expect(hexHeadingBetween(4, 4, 4, 6)).toBe(HEX_HEADING.SW);
    expect(hexHeadingBetween(4, 4, 4, 4)).toBe(HEX_HEADING.E);
  });
});

describe('landedDamage - a person struck from each side', () => {
  it('lands x1 from the front and front sides, x1.25 from the back sides, x1.5 from behind', () => {
    const { sim, striker } = setup();
    const victim = fighterAtNode(sim, VICTIM.hx, VICTIM.hy, OTHER, null);
    facing(sim, victim, WALK_DIRECTION.E);
    expect(blowFrom(sim, striker, victim, EAST)).toBe(BASE);
    expect(blowFrom(sim, striker, victim, NORTH_EAST)).toBe(BASE);
    expect(blowFrom(sim, striker, victim, SOUTH_EAST)).toBe(BASE);
    expect(blowFrom(sim, striker, victim, NORTH_WEST)).toBe(1250);
    expect(blowFrom(sim, striker, victim, SOUTH_WEST)).toBe(1250);
    expect(blowFrom(sim, striker, victim, WEST)).toBe(1500);
  });

  it('bins the difference wrapped around the ring, so both sides count alike', () => {
    const { sim, striker } = setup();
    const victim = fighterAtNode(sim, VICTIM.hx, VICTIM.hy, OTHER, null);
    facing(sim, victim, WALK_DIRECTION.NE); // heading 5: E (0) is one step away across the wrap
    expect(blowFrom(sim, striker, victim, EAST)).toBe(BASE);
    expect(blowFrom(sim, striker, victim, SOUTH_EAST)).toBe(1250);
    expect(blowFrom(sim, striker, victim, SOUTH_WEST)).toBe(1500);
  });

  it('reads a north facing as NE and a south facing as SW', () => {
    const { sim, striker } = setup();
    const north = fighterAtNode(sim, VICTIM.hx, VICTIM.hy, OTHER, null);
    facing(sim, north, WALK_DIRECTION.N);
    expect(blowFrom(sim, striker, north, SOUTH_WEST)).toBe(1500);
    sim.world.mut(north, WalkFacing).direction = WALK_DIRECTION.S;
    expect(blowFrom(sim, striker, north, NORTH_EAST)).toBe(1500);
  });

  it('counts a person that never turned as facing its striker', () => {
    const { sim, striker } = setup();
    const victim = fighterAtNode(sim, VICTIM.hx, VICTIM.hy, OTHER, null);
    expect(blowFrom(sim, striker, victim, WEST)).toBe(BASE);
  });

  it("takes the armor's blockingValue off after the direction multiplier, and nothing lands at or below 0", () => {
    const { sim, striker } = setup();
    const victim = fighterAtNode(sim, VICTIM.hx, VICTIM.hy, OTHER, null, { armorClass: CHAIN_CLASS });
    facing(sim, victim, WALK_DIRECTION.E);
    expect(blowFrom(sim, striker, victim, WEST)).toBe((BASE * 3) / 2 - ARMOR_BLOCKING);
    const from = positionOfNode(VICTIM.hx + 1, VICTIM.hy);
    expect(landedDamage(sim.world, ctxOf(sim), striker, victim, ARMOR_BLOCKING, from)).toBe(0);
  });
});

describe('landedDamage - animals and buildings', () => {
  it('an animal takes the leather column, from any side and with no blockingValue', () => {
    const { sim, striker } = setup();
    const wolf = fighterAtNode(sim, VICTIM.hx, VICTIM.hy, WOLF_TRIBE, null, { armorClass: CHAIN_CLASS });
    expect(targetMaterial(sim.world, ctxOf(sim), wolf)).toBe(ARMOR_MATERIAL.LEATHER);
    expect(blowFrom(sim, striker, wolf, WEST)).toBe(BASE);
  });

  it('a building takes the house column, a zero base does nothing, and no side or armor counts', () => {
    const { sim, striker } = setup();
    const house = sim.world.create();
    sim.world.add(house, Position, positionOfNode(VICTIM.hx, VICTIM.hy));
    sim.world.add(house, Building, { buildingType: 1, tribe: VIKING, built: 0, level: 0 });
    sim.world.add(house, Health, { hitpoints: BASE, max: BASE });
    expect(targetMaterial(sim.world, ctxOf(sim), house)).toBe(ARMOR_MATERIAL.HOUSE);
    expect(blowFrom(sim, striker, house, WEST)).toBe(BASE);
    const from = positionOfNode(VICTIM.hx + 1, VICTIM.hy);
    expect(landedDamage(sim.world, ctxOf(sim), striker, house, 0, from)).toBe(0);
  });
});
