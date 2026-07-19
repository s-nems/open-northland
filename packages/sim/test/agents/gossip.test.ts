import { describe, expect, it } from 'vitest';
import {
  Chat,
  ChatCooldown,
  CurrentAtomic,
  MoveGoal,
  Owner,
  PlayerOrder,
  Position,
  Settler,
  setNeedsEnabled,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { type Fixed, fx, ONE, Simulation } from '../../src/index.js';
import { nodeOfPosition, nodesAdjacent } from '../../src/nav/halfcell.js';
import { aiSystem, CHAT_COOLDOWN_TICKS, gossipSystem } from '../../src/systems/index.js';
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

/** A gossiper standing half a cell east of cell `x` — the lattice node beside a cell-anchored partner
 *  (partner searches start at ring 1, so a pair never forms on a single shared node). */
function gossiperBeside(sim: Simulation, x: number, y: number, enjoyment: Fixed): Entity {
  const e = gossiper(sim, x, y, enjoyment);
  sim.world.get(e, Position).x = fx.add(fx.fromInt(x), fx.div(ONE, fx.fromInt(2)));
  return e;
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

  it('idle settlers standing beside each other pair up spontaneously', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    // No tree — nothing to do. Both mildly deprived, on neighbouring lattice nodes.
    const a = gossiper(sim, 1, 0, MILD);
    const b = gossiperBeside(sim, 1, 0, MILD);

    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(a, Chat)).toMatchObject({ partner: b, seeker: true });
    expect(sim.world.get(b, Chat)).toMatchObject({ partner: a, seeker: false });
  });

  it('a distant idle pair pairs up only after the paced wander roll — never on the first pass', () => {
    // Seed 5: the seeded stream's first 1/240 hit lands ~80 ticks in (an early-stream mulberry32
    // artifact makes some tiny seeds fire on the very first draw — that would defeat the "stands
    // around first" half of this test).
    const sim = new Simulation({ seed: 5, content: testContent(), map: grassMap(8, 1) });
    setNeedsEnabled(sim.world, false); // bars frozen at 0: the seek rung can't fire — only the wander can
    const a = gossiper(sim, 1, 0, fx.fromInt(0));
    const b = gossiper(sim, 3, 0, fx.fromInt(0));

    aiSystem(sim.world, ctxOf(sim));

    // Nobody adjacent: no instant pairing and no instant walk — the wander waits out its 1/N-per-tick
    // roll, so idlers stand around instead of herding together the moment they spawn.
    expect(sim.world.has(a, Chat)).toBe(false);
    expect(sim.world.has(b, Chat)).toBe(false);
    expect(sim.world.has(a, MoveGoal)).toBe(false);

    // Deterministically (seeded roll) one of them eventually wanders over and the pair talks from
    // neighbouring lattice nodes — the bound covers many multiples of the mean wait.
    let talked = false;
    for (let i = 0; i < 3000 && !talked; i++) {
      sim.step();
      talked =
        sim.world.tryGet(a, CurrentAtomic)?.atomicId === TALK ||
        sim.world.tryGet(b, CurrentAtomic)?.atomicId === TALK;
    }
    expect(talked).toBe(true);
    const pa = sim.world.get(a, Position);
    const pb = sim.world.get(b, Position);
    expect(nodesAdjacent(nodeOfPosition(pa.x, pa.y), nodeOfPosition(pb.x, pb.y))).toBe(true);
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('idle settlers chat even on a full company bar (no deficit required)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const a = gossiper(sim, 1, 0, fx.fromInt(0));
    const b = gossiperBeside(sim, 1, 0, fx.fromInt(0));

    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(a, Chat)).toMatchObject({ partner: b, seeker: true });
    expect(sim.world.get(b, Chat)).toMatchObject({ partner: a, seeker: false });
  });

  it('a finished chat leaves a cooldown: the pair rests, then chats again', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const a = gossiper(sim, 1, 0, MILD);
    gossiperBeside(sim, 1, 0, MILD); // the neighbour `a` chats with — asserted through `a`'s side only

    let ended = false;
    for (let i = 0; i < 200 && !ended; i++) {
      sim.step();
      ended = sim.world.has(a, ChatCooldown) && !sim.world.has(a, Chat);
    }
    expect(ended).toBe(true); // the first chat ran its rounds and ended with the breather stamped
    sim.step();
    expect(sim.world.has(a, Chat)).toBe(false); // no instant re-grab — the planner pass stays free

    let rechatted = false;
    for (let i = 0; i < 2 * CHAT_COOLDOWN_TICKS && !rechatted; i++) {
      sim.step();
      rechatted = sim.world.has(a, Chat);
    }
    expect(rechatted).toBe(true); // the breather expired and the idle neighbours got back to gossip
  });

  it('idle chatter keeps running with needs disabled (social flavor, not a need mechanic)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    setNeedsEnabled(sim.world, false);
    const a = gossiper(sim, 2, 0, fx.fromInt(0));
    const b = gossiperBeside(sim, 2, 0, fx.fromInt(0));

    aiSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(a, Chat)).toMatchObject({ partner: b, seeker: true });

    gossipSystem(sim.world, ctxOf(sim)); // used to cancel every chat when needs were off
    expect(sim.world.get(a, CurrentAtomic).atomicId).toBe(TALK);
    expect(sim.world.get(b, CurrentAtomic).atomicId).toBe(LISTEN);
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
    const b = gossiperBeside(sim, 2, 0, fx.fromInt(0));
    aiSystem(sim.world, ctxOf(sim)); // pairs them (adjacent nodes — already in range)

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

  it('a round fires the clips’ authored voice cues as chatVoice events (talker frame 0, listener mid-clip)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const a = gossiper(sim, 2, 0, LONELY);
    const b = gossiperBeside(sim, 2, 0, fx.fromInt(0));

    const voices: { entity: Entity; soundType: number }[] = [];
    for (let i = 0; i < 30; i++) {
      sim.step();
      for (const ev of sim.snapshot().events) {
        if (ev.kind === 'chatVoice') voices.push({ entity: ev.entity, soundType: ev.soundType });
      }
    }
    // The fixture clips voice `logicSoundType` 61 (SocialTalk — societies.ts): the talker opens the
    // round at frame 0 and the listener responds at frame 10, so ONE 20-tick round yields both halves.
    expect(voices.length).toBeGreaterThanOrEqual(2);
    expect(voices.every((v) => v.soundType === 61)).toBe(true);
    expect(new Set(voices.map((v) => v.entity))).toEqual(new Set([a, b]));
  });

  it('the clip pulses refill both bars mid-round and a satisfied seeker goes back to work', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const a = gossiper(sim, 2, 0, LONELY);
    const b = gossiperBeside(sim, 2, 0, MILD);
    treeAt(sim, 6, 0); // the errand the seeker abandoned — reclaimed once the chat satisfies it
    aiSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(a, Chat)).toMatchObject({ partner: b, seeker: true });

    const before = sim.world.get(a, Settler).enjoyment;
    // Half the 20-tick round: some (not all) of the five +800 pulses have landed.
    for (let i = 0; i < 10; i++) sim.step();
    const midway = sim.world.get(a, Settler).enjoyment;
    expect(midway).toBeLessThan(before);
    expect(midway).toBeGreaterThan(fx.fromInt(0));

    // The full round restores a full bar (5×800 = 4000 units): the satisfied seeker leaves the chat, and
    // with its company met the work rung wins again — it walks off to the tree instead of re-chatting.
    let backToWork = false;
    for (let i = 0; i < 60 && !backToWork; i++) {
      sim.step();
      backToWork = !sim.world.has(a, Chat) && sim.world.has(a, MoveGoal);
    }
    expect(backToWork).toBe(true);
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
    // No gap: the pair talks from neighbouring lattice nodes, not across a free node.
    const ps = sim.world.get(seeker, Position);
    const pp = sim.world.get(partner, Position);
    expect(nodesAdjacent(nodeOfPosition(ps.x, ps.y), nodeOfPosition(pp.x, pp.y))).toBe(true);
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('a pressing survival need cancels the chat (company never outranks hunger)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const a = gossiper(sim, 2, 0, LONELY);
    const b = gossiperBeside(sim, 2, 0, fx.fromInt(0));
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

  it('a player order on one half ends the chat — the other never talks into the air', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const a = gossiper(sim, 2, 0, LONELY);
    const b = gossiperBeside(sim, 2, 0, fx.fromInt(0));
    aiSystem(sim.world, ctxOf(sim));
    gossipSystem(sim.world, ctxOf(sim)); // the round starts

    // A move order steals `b` mid-round (moveUnit clears its atomic and stamps PlayerOrder).
    sim.world.remove(b, CurrentAtomic);
    sim.world.add(b, PlayerOrder, {});
    gossipSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(a, Chat)).toBe(false);
    expect(sim.world.has(b, Chat)).toBe(false);
    expect(sim.world.has(a, CurrentAtomic)).toBe(false); // the talker was cut too, not left mid-clip
  });

  it('a half whose clip is stolen mid-round ends the chat for both (no marker, just the interruption)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const a = gossiper(sim, 2, 0, LONELY);
    const b = gossiperBeside(sim, 2, 0, fx.fromInt(0));
    aiSystem(sim.world, ctxOf(sim));
    gossipSystem(sim.world, ctxOf(sim));

    sim.world.remove(b, CurrentAtomic); // some other system took the listener's clip
    gossipSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(a, Chat)).toBe(false);
    expect(sim.world.has(b, Chat)).toBe(false);
    expect(sim.world.has(a, CurrentAtomic)).toBe(false);
  });

  it('a dead partner ends the chat cleanly', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const a = gossiper(sim, 2, 0, LONELY);
    const b = gossiperBeside(sim, 2, 0, fx.fromInt(0));
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
