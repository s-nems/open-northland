import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  Anger,
  Building,
  diplomacyStance,
  Health,
  Owner,
  Position,
  SettlerProgress,
  setDiplomacyStance,
  WALK_DIRECTION,
  type WalkDirection,
  WalkFacing,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { Simulation } from '../../src/index.js';
import { HEX_HEADING, hexHeadingBetween, hexNeighboursOf, positionOfNode } from '../../src/nav/halfcell.js';
import { targetMaterial } from '../../src/systems/conflict/weapons.js';
import { ARMOR_MATERIAL, WEAPON_MAIN_TYPE } from '../../src/systems/index.js';
import { landedDamage } from '../../src/systems/settlers/atomics/effects/combat/hit/damage.js';
import type { PendingHitReaction } from '../../src/systems/settlers/atomics/effects/combat/hit/reaction.js';
import { resolveCombatHit } from '../../src/systems/settlers/atomics/effects/combat/hit/resolution.js';
import {
  ARMOR_BLOCKING,
  CHAIN_CLASS,
  combatCadenceContent,
  ctxOf,
  fighterAtNode,
  grass,
  OTHER,
  SAXON,
  VIKING,
  WOLF_TRIBE,
  WOMAN,
} from './combat-cadence/support.js';

// The victim stands on an even-row node; its six map-point neighbours, in `hexNeighboursOf` order.
const VICTIM = { hx: 4, hy: 4 } as const;
const [EAST, WEST, NORTH_WEST, NORTH_EAST, SOUTH_WEST, SOUTH_EAST] = hexNeighboursOf(VICTIM.hx, VICTIM.hy);
const BASE = 1000;
/** A provoked beast's anger span in ticks. */
const ANGRY_TICKS = 10;

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
  // Even rows, and odd rows on both column parities, where the half-node shift moves the diagonals.
  for (const centre of [VICTIM, { hx: 4, hy: 5 }, { hx: 7, hy: 3 }]) {
    it(`reads each neighbour of (${centre.hx}, ${centre.hy}) as its own heading`, () => {
      const headings = hexNeighboursOf(centre.hx, centre.hy).map((n) =>
        hexHeadingBetween(centre.hx, centre.hy, n.hx, n.hy),
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
  }

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

  it('counts a person that never turned as facing SW, where every person starts', () => {
    const { sim, striker } = setup();
    const victim = fighterAtNode(sim, VICTIM.hx, VICTIM.hy, OTHER, null);
    expect(blowFrom(sim, striker, victim, SOUTH_WEST)).toBe(BASE);
    expect(blowFrom(sim, striker, victim, EAST)).toBe(1250);
    expect(blowFrom(sim, striker, victim, NORTH_EAST)).toBe(1500);
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

describe('resolveCombatHit - a blow that does no damage', () => {
  const ATTACKER_PLAYER = 0;
  const VICTIM_PLAYER = 1;
  const swing = (damage: number) => ({ damage, weaponMainType: WEAPON_MAIN_TYPE.SPEAR, hitSoundType: 1 });

  function armoredPair(): { sim: Simulation; striker: Entity; victim: Entity } {
    const { sim, striker } = setup();
    const victim = fighterAtNode(sim, 1, 0, OTHER, null, { armorClass: CHAIN_CLASS, hitpoints: BASE });
    sim.world.add(striker, Owner, { player: ATTACKER_PLAYER });
    sim.world.add(victim, Owner, { player: VICTIM_PLAYER });
    setDiplomacyStance(sim.world, VICTIM_PLAYER, ATTACKER_PLAYER, 'neutral');
    return { sim, striker, victim };
  }

  it('is silent, earns nothing and is no attack when the armor takes it all', () => {
    const { sim, striker, victim } = armoredPair();
    const landed = resolveCombatHit(
      sim.world,
      ctxOf(sim),
      striker,
      victim,
      swing(ARMOR_BLOCKING),
      [],
      'melee',
    );
    expect(landed).toBe(false);
    expect(sim.world.get(victim, Health).hitpoints).toBe(BASE);
    expect(sim.events.current().filter((ev) => ev.kind === 'combatHit')).toEqual([]);
    expect(sim.world.get(striker, SettlerProgress).experience.size).toBe(0);
    expect(diplomacyStance(sim.world, VICTIM_PLAYER, ATTACKER_PLAYER)).toBe('neutral');

    expect(
      resolveCombatHit(sim.world, ctxOf(sim), striker, victim, swing(ARMOR_BLOCKING + 1), [], 'melee'),
    ).toBe(true);
    expect(sim.events.current().filter((ev) => ev.kind === 'combatHit')).toHaveLength(1);
    expect(diplomacyStance(sim.world, VICTIM_PLAYER, ATTACKER_PLAYER)).toBe('enemy');
  });

  it('still angers a beast and makes a person react, as the original does whatever the damage', () => {
    const { sim, striker } = setup();
    // A civilian, whose tribe binds the stagger clip a blow plays on it.
    const civilian = fighterAtNode(sim, 1, 0, SAXON, WOMAN, { armorClass: CHAIN_CLASS, hitpoints: BASE });
    const reactions: PendingHitReaction[] = [];
    resolveCombatHit(sim.world, ctxOf(sim), striker, civilian, swing(ARMOR_BLOCKING), reactions, 'melee');
    expect(sim.world.get(civilian, Health).hitpoints).toBe(BASE);
    expect(reactions).toHaveLength(1);

    const base = combatCadenceContent();
    const provokable = parseContentSet({
      ...base,
      animals: base.animals.map((a) => ({ ...a, getAngry: true, angryGameTime: ANGRY_TICKS })),
    });
    const wild = new Simulation({ seed: 1, content: provokable, map: grass(6, 6) });
    const hunter = fighterAtNode(wild, 0, 0, VIKING, WOMAN);
    const wolf = fighterAtNode(wild, 1, 0, WOLF_TRIBE, null, { hitpoints: BASE });
    resolveCombatHit(wild.world, ctxOf(wild), hunter, wolf, swing(0), [], 'melee');
    expect(wild.world.get(wolf, Health).hitpoints).toBe(BASE);
    expect(wild.world.has(wolf, Anger)).toBe(true);
  });

  it('does nothing at all to a building whose column is zero', () => {
    const { sim, striker } = setup();
    const house = sim.world.create();
    sim.world.add(house, Position, positionOfNode(1, 0));
    sim.world.add(house, Building, { buildingType: 1, tribe: VIKING, built: 0, level: 0 });
    sim.world.add(house, Health, { hitpoints: BASE, max: BASE });
    expect(resolveCombatHit(sim.world, ctxOf(sim), striker, house, swing(0), [], 'melee')).toBe(false);
    expect(sim.world.get(house, Health).hitpoints).toBe(BASE);
    expect(sim.events.current()).toEqual([]);
  });
});
