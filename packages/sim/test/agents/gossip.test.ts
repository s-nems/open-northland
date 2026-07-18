import { describe, expect, it } from 'vitest';
import { Chat, CurrentAtomic, MoveGoal, Owner, Settler } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { type Fixed, fx, ONE, Simulation } from '../../src/index.js';
import { aiSystem, gossipSystem } from '../../src/systems/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf, grassMap, justAbove, NEED_THRESHOLD, needsSettlerAt, treeAt } from './needs/support.js';

/**
 * Tests for the GOSSIP drive — the company need's self-satisfying loop: a lonely settler pairs up with
 * another, the pair stands adjacent and alternates the talk/listen atomics (14/15, `logicdefines.inc`),
 * and the clips' channel-3 pulses refill `enjoyment`. Soldiers are excluded (the original's
 * `jobtypes.ini` soldier `forbidatomic 13/14/15`); the fixture talk/listen clips carry the original's
 * 5×800 pulse shape compressed to 20 ticks (fixtures/content/societies.ts).
 */

const TALK = 14;
const LISTEN = 15;
const PLAYER = 1;
const SOLDIER_JOB = 31; // soldier_unarmed — isFighterJob band start
const LONELY: Fixed = justAbove(NEED_THRESHOLD); // over the ¾·ONE chat-seek threshold
const MILD: Fixed = fx.div(ONE, fx.fromInt(2)); // half a bar — idle-chat eligible, seek-quiet

function owned(sim: Simulation, e: Entity): Entity {
  sim.world.add(e, Owner, { player: PLAYER });
  return e;
}

function gossiper(sim: Simulation, x: number, y: number, enjoyment: Fixed): Entity {
  return owned(sim, needsSettlerAt(sim, x, y, { enjoyment }));
}

describe('gossip initiation (planner rungs)', () => {
  it('a lonely worker leaves its work to chat with a nearby idle settler', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const lonely = gossiper(sim, 1, 0, LONELY);
    const idler = gossiper(sim, 3, 0, fx.fromInt(0));
    treeAt(sim, 6, 0); // work exists, but company outranks it at the seek threshold

    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(lonely, Chat)).toMatchObject({ partner: idler, seeker: true });
    expect(sim.world.get(idler, Chat)).toMatchObject({ partner: lonely, seeker: false });
  });

  it('below the seek threshold the worker works; two idle neighbours still chat', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const worker = gossiper(sim, 1, 0, MILD);
    treeAt(sim, 6, 0);

    aiSystem(sim.world, ctxOf(sim));

    // Mild deficit: the tree wins (no chat), the settler heads to work.
    expect(sim.world.has(worker, Chat)).toBe(false);
    expect(sim.world.has(worker, MoveGoal)).toBe(true);
  });

  it('idle settlers with nothing to do pair up spontaneously', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    // No tree — nothing to do. Both mildly deprived, standing near each other.
    const a = gossiper(sim, 1, 0, MILD);
    const b = gossiper(sim, 3, 0, MILD);

    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(a, Chat)).toMatchObject({ partner: b, seeker: true });
    expect(sim.world.get(b, Chat)).toMatchObject({ partner: a, seeker: false });
  });

  it('soldiers never gossip — neither seeking nor as a partner (forbidatomic 13/14/15)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const soldier = owned(sim, needsSettlerAt(sim, 1, 0, { enjoyment: LONELY }));
    sim.world.get(soldier, Settler).jobType = SOLDIER_JOB;
    const civilian = gossiper(sim, 3, 0, LONELY);

    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(soldier, Chat)).toBe(false);
    expect(sim.world.has(civilian, Chat)).toBe(false); // nobody in range but the soldier
  });

  it('unowned settlers never gossip (fixture worlds stay inert)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const a = needsSettlerAt(sim, 1, 0, { enjoyment: LONELY });
    needsSettlerAt(sim, 3, 0, { enjoyment: LONELY });

    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(a, Chat)).toBe(false);
  });
});

describe('gossip chat rounds (GossipSystem)', () => {
  it('an adjacent pair starts a talk/listen round facing each other, on the shared clock', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const a = gossiper(sim, 2, 0, LONELY);
    const b = gossiper(sim, 2, 0, fx.fromInt(0));
    aiSystem(sim.world, ctxOf(sim)); // pairs them (same node — already in range)

    gossipSystem(sim.world, ctxOf(sim));

    const talkAtomic = sim.world.get(a, CurrentAtomic);
    const listenAtomic = sim.world.get(b, CurrentAtomic);
    expect(talkAtomic.atomicId).toBe(TALK); // the seeker speaks the first round
    expect(listenAtomic.atomicId).toBe(LISTEN);
    expect(talkAtomic.duration).toBe(20); // fixture viking_talk length
    expect(listenAtomic.duration).toBe(20);
    expect(talkAtomic.targetEntity).toBe(b); // each half targets its partner (render faces them)
    expect(listenAtomic.targetEntity).toBe(a);
  });

  it('the clip pulses refill both bars mid-round and the chat ends once the seeker is satisfied', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const a = gossiper(sim, 2, 0, LONELY);
    const b = gossiper(sim, 2, 0, MILD);
    aiSystem(sim.world, ctxOf(sim));

    const before = sim.world.get(a, Settler).enjoyment;
    // Half the 20-tick round: some (not all) of the five +800 pulses have landed.
    for (let i = 0; i < 10; i++) sim.step();
    const midway = sim.world.get(a, Settler).enjoyment;
    expect(midway).toBeLessThan(before);
    expect(midway).toBeGreaterThan(fx.fromInt(0));

    for (let i = 0; i < 30; i++) sim.step();
    // The full round restored a full bar (5×800 = 4000 units): both are satisfied, the chat is over.
    expect(sim.world.has(a, Chat)).toBe(false);
    expect(sim.world.has(b, Chat)).toBe(false);
    expect(sim.world.get(a, Settler).enjoyment).toBeLessThan(fx.div(ONE, fx.fromInt(10)));
  });

  it('the seeker walks to a distant partner, then the pair talks', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(12, 1) });
    const seeker = gossiper(sim, 1, 0, LONELY);
    const partner = gossiper(sim, 8, 0, fx.fromInt(0));

    aiSystem(sim.world, ctxOf(sim)); // pair up (out of talk range)
    expect(sim.world.get(seeker, Chat).partner).toBe(partner);

    let talked = false;
    for (let i = 0; i < 300 && !talked; i++) {
      sim.step();
      talked = sim.world.tryGet(seeker, CurrentAtomic)?.atomicId === TALK;
    }
    expect(talked).toBe(true);
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('a pressing survival need cancels the chat (company never outranks hunger)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const a = gossiper(sim, 2, 0, LONELY);
    const b = gossiper(sim, 2, 0, fx.fromInt(0));
    aiSystem(sim.world, ctxOf(sim));
    gossipSystem(sim.world, ctxOf(sim)); // the round starts

    sim.world.get(b, Settler).hunger = justAbove(NEED_THRESHOLD);
    gossipSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(a, Chat)).toBe(false);
    expect(sim.world.has(b, Chat)).toBe(false);
    // The interruptible talk/listen clips were cut short so the eat drive can fire at once.
    expect(sim.world.has(a, CurrentAtomic)).toBe(false);
    expect(sim.world.has(b, CurrentAtomic)).toBe(false);
  });

  it('a dead partner ends the chat cleanly', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const a = gossiper(sim, 2, 0, LONELY);
    const b = gossiper(sim, 2, 0, fx.fromInt(0));
    aiSystem(sim.world, ctxOf(sim));

    sim.world.destroy(b);
    gossipSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(a, Chat)).toBe(false);
  });

  it('is byte-identical across two same-seed runs (determinism)', () => {
    const run = (): string => {
      const sim = new Simulation({ seed: 9, content: testContent(), map: grassMap(10, 1) });
      gossiper(sim, 1, 0, LONELY);
      gossiper(sim, 4, 0, MILD);
      gossiper(sim, 7, 0, MILD);
      for (let i = 0; i < 300; i++) sim.step();
      return sim.hashState();
    };
    expect(run()).toBe(run());
  });
});
