import { describe, expect, it } from 'vitest';
import {
  DiplomacyRules,
  diplomacyStance,
  Engagement,
  Fleeing,
  FOG_MODE,
  Health,
  PlayerContacts,
  setDiplomacyStance,
} from '../../src/components/index.js';
import { Simulation } from '../../src/index.js';
import { combatSystem } from '../../src/systems/index.js';
import { MILITARY_MODE } from '../../src/systems/readviews/index.js';
import { provokeHostility } from '../../src/systems/settlers/atomics/effects/combat/hit/reactions.js';
import { testContent } from '../fixtures/content.js';
import { fighterAt, grassMap, P0, P1, VIKING, WOODCUTTER } from './melee-engagement/support.js';
import { combatant, ctxOf } from './stances/support.js';

/**
 * The diplomacy table on the owner axis of `mayTarget`: two player-owned combatants engage only when
 * the attacker's directed stance toward the target's player is `enemy`, and a pair no command ever set
 * defaults to `enemy` - the everyone-hostile behavior worlds without diplomacy keep.
 */

const TICKS = 60;

function skirmishSim(): Simulation {
  return new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
}

describe('diplomacyStance - the DiplomacyRules read/write pair', () => {
  it('defaults every pair to enemy while the singleton is absent', () => {
    const sim = skirmishSim();
    expect(diplomacyStance(sim.world, P0, P1)).toBe('enemy');
    expect(sim.world.lowestEntityWith(DiplomacyRules)).toBeNull();
  });

  it('stores a directed stance: setting from->to leaves to->from at its default', () => {
    const sim = skirmishSim();
    setDiplomacyStance(sim.world, P0, P1, 'friend');
    expect(diplomacyStance(sim.world, P0, P1)).toBe('friend');
    expect(diplomacyStance(sim.world, P1, P0)).toBe('enemy');
  });

  it('skips an invalid player slot and an unknown state without creating the singleton', () => {
    const sim = skirmishSim();
    setDiplomacyStance(sim.world, 99, P0, 'friend');
    setDiplomacyStance(sim.world, P0, -1, 'friend');
    setDiplomacyStance(sim.world, P0, P1, 'bogus');
    expect(sim.world.lowestEntityWith(DiplomacyRules)).toBeNull();
    expect(diplomacyStance(sim.world, P0, P1)).toBe('enemy');
  });

  it('reads enemy for an invalid slot instead of aliasing a valid pair through the key arithmetic', () => {
    const sim = skirmishSim();
    setDiplomacyStance(sim.world, P0, P1, 'friend');
    // -1 * MAX_PLAYERS + 17 lands on the (0, 1) key; the slot guard must answer before the lookup.
    expect(diplomacyStance(sim.world, -1, 17)).toBe('enemy');
  });

  it('a blow from or on an unowned combatant, or between default enemies, never grows the table', () => {
    const sim = skirmishSim();
    const owned = fighterAt(sim, 0, 0, VIKING, WOODCUTTER, { owner: P0 });
    const wild = fighterAt(sim, 1, 0, VIKING, WOODCUTTER, {});
    const foe = fighterAt(sim, 2, 0, VIKING, WOODCUTTER, { owner: P1 });
    provokeHostility(sim.world, ctxOf(sim), wild, owned);
    provokeHostility(sim.world, ctxOf(sim), owned, wild);
    provokeHostility(sim.world, ctxOf(sim), foe, owned); // both owned, but the pair already reads enemy
    expect(sim.world.lowestEntityWith(DiplomacyRules)).toBeNull();
    expect(sim.world.lowestEntityWith(PlayerContacts)).toBeNull(); // fog off - no contact write either
  });

  it('a landed blow under fog records the victim-to-attacker contact, even unseen', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(20, 1) });
    sim.enqueueSetup({ kind: 'setFogMode', mode: FOG_MODE.RECON });
    // 15 cells = 1020 px apart: beyond both 408 px civilian eyes, so only the blow reveals anything.
    const attacker = fighterAt(sim, 0, 0, VIKING, WOODCUTTER, { owner: P0 });
    const victim = fighterAt(sim, 15, 0, VIKING, WOODCUTTER, { owner: P1 });
    sim.step(); // apply the mode and settle the first rebuild

    provokeHostility(sim.world, ctxOf(sim), attacker, victim);

    expect(sim.hasMetPlayer(P1, P0)).toBe(true); // the victim learned who struck it
    expect(sim.hasMetPlayer(P0, P1)).toBe(false); // the attacker learned nothing new
  });
});

describe('diplomacy in combat targeting (owner axis, full step() schedule)', () => {
  it('two owned players with no diplomacy set engage each other - the default stays hostile', () => {
    const sim = skirmishSim();
    const a = fighterAt(sim, 0, 0, VIKING, WOODCUTTER, { owner: P0 });
    const b = fighterAt(sim, 1, 0, VIKING, WOODCUTTER, { owner: P1 });

    sim.step();

    expect(sim.world.has(a, Engagement)).toBe(true);
    expect(sim.world.has(b, Engagement)).toBe(true);
  });

  it('mutual friends never auto-engage: no engagement and no damage over a long run', () => {
    const sim = skirmishSim();
    const a = fighterAt(sim, 0, 0, VIKING, WOODCUTTER, { owner: P0 });
    const b = fighterAt(sim, 1, 0, VIKING, WOODCUTTER, { owner: P1 });
    sim.enqueueSetup({ kind: 'setDiplomacy', from: P0, to: P1, state: 'friend' });
    sim.enqueueSetup({ kind: 'setDiplomacy', from: P1, to: P0, state: 'friend' });

    for (let i = 0; i < TICKS; i++) sim.step();

    expect(sim.world.has(a, Engagement)).toBe(false);
    expect(sim.world.has(b, Engagement)).toBe(false);
    expect(sim.world.get(a, Health).hitpoints).toBe(sim.world.get(a, Health).max);
    expect(sim.world.get(b, Health).hitpoints).toBe(sim.world.get(b, Health).max);
  });

  it('a neutral stance does not auto-engage either (approximation: treated like friend here)', () => {
    const sim = skirmishSim();
    const a = fighterAt(sim, 0, 0, VIKING, WOODCUTTER, { owner: P0 });
    const b = fighterAt(sim, 1, 0, VIKING, WOODCUTTER, { owner: P1 });
    sim.enqueueSetup({ kind: 'setDiplomacy', from: P0, to: P1, state: 'neutral' });
    sim.enqueueSetup({ kind: 'setDiplomacy', from: P1, to: P0, state: 'neutral' });

    for (let i = 0; i < TICKS; i++) sim.step();

    expect(sim.world.has(a, Engagement)).toBe(false);
    expect(sim.world.has(b, Engagement)).toBe(false);
  });

  it('a struck player turns on a one-way aggressor: the friend stance flips to enemy and retaliates', () => {
    const sim = skirmishSim();
    const aggressor = fighterAt(sim, 0, 0, VIKING, WOODCUTTER, { owner: P0, hitpoints: 1_000_000 });
    const pacified = fighterAt(sim, 1, 0, VIKING, WOODCUTTER, { owner: P1, hitpoints: 1_000_000 });
    sim.enqueueSetup({ kind: 'setDiplomacy', from: P0, to: P1, state: 'enemy' });
    sim.enqueueSetup({ kind: 'setDiplomacy', from: P1, to: P0, state: 'friend' });

    for (let i = 0; i < TICKS; i++) sim.step();

    // The first landed blow flipped the victim's stance, so the war became mutual.
    expect(diplomacyStance(sim.world, P1, P0)).toBe('enemy');
    const aggressorHealth = sim.world.get(aggressor, Health);
    const pacifiedHealth = sim.world.get(pacified, Health);
    expect(pacifiedHealth.hitpoints).toBeLessThan(pacifiedHealth.max); // the enemy stance struck first
    expect(aggressorHealth.hitpoints).toBeLessThan(aggressorHealth.max); // and the struck side hit back
  });

  it('an explicit attack order on a friend is skipped like any other invalid target', () => {
    const sim = skirmishSim();
    const a = fighterAt(sim, 0, 0, VIKING, WOODCUTTER, { owner: P0 });
    const friend = fighterAt(sim, 1, 0, VIKING, WOODCUTTER, { owner: P1 });
    sim.enqueueSetup({ kind: 'setDiplomacy', from: P0, to: P1, state: 'friend' });
    sim.enqueueSetup({ kind: 'setDiplomacy', from: P1, to: P0, state: 'friend' });
    sim.step(); // stances applied before the order below, so the order sees the friendship

    sim.enqueueSetup({ kind: 'attackUnit', entity: a, target: friend });
    for (let i = 0; i < TICKS; i++) sim.step();

    expect(sim.world.has(a, Engagement)).toBe(false);
    expect(sim.world.get(friend, Health).hitpoints).toBe(sim.world.get(friend, Health).max);
  });

  it('same-player entities stay non-hostile even under an authored self-enemy row', () => {
    const sim = skirmishSim();
    const a = fighterAt(sim, 0, 0, VIKING, WOODCUTTER, { owner: P0 });
    const b = fighterAt(sim, 1, 0, VIKING, WOODCUTTER, { owner: P0 });
    sim.enqueueSetup({ kind: 'setDiplomacy', from: P0, to: P0, state: 'enemy' });

    for (let i = 0; i < TICKS; i++) sim.step();

    expect(sim.world.has(a, Engagement)).toBe(false);
    expect(sim.world.has(b, Engagement)).toBe(false);
  });

  it('a civilian flees a one-way aggressor its own stance would not engage', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const civ = combatant(sim, 20, 0, P0, MILITARY_MODE.FLEE);
    combatant(sim, 25, 0, P1, MILITARY_MODE.IGNORE);
    // The cn_4 shape: the fleer's player is neutral toward the aggressor, the aggressor enemy back.
    setDiplomacyStance(sim.world, P0, P1, 'neutral');
    setDiplomacyStance(sim.world, P1, P0, 'enemy');

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(civ, Fleeing)).toBe(true);
  });

  it('a civilian does not flee an allied soldier standing beside it', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const civ = combatant(sim, 20, 0, P0, MILITARY_MODE.FLEE);
    combatant(sim, 25, 0, P1, MILITARY_MODE.IGNORE);
    setDiplomacyStance(sim.world, P0, P1, 'friend');
    setDiplomacyStance(sim.world, P1, P0, 'friend');

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(civ, Fleeing)).toBe(false);
  });

  it('is deterministic: two same-seed runs with diplomacy commands reach the same state hash', () => {
    const run = (): string => {
      const sim = skirmishSim();
      fighterAt(sim, 0, 0, VIKING, WOODCUTTER, { owner: P0, hitpoints: 500 });
      fighterAt(sim, 1, 0, VIKING, WOODCUTTER, { owner: P1, hitpoints: 500 });
      sim.enqueueSetup({ kind: 'setDiplomacy', from: P0, to: P1, state: 'friend' });
      sim.enqueueSetup({ kind: 'setDiplomacy', from: P1, to: P0, state: 'enemy' });
      for (let i = 0; i < TICKS; i++) sim.step();
      return sim.hashState();
    };
    expect(run()).toBe(run());
  });
});
