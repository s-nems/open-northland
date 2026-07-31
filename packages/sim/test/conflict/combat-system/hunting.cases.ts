import { describe, expect, it } from 'vitest';
import {
  CurrentAtomic,
  DeliveryFlag,
  Engagement,
  Position,
  Resource,
  WorkFlag,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { positionOfNode, Simulation } from '../../../src/index.js';
import { combatSystem } from '../../../src/systems/index.js';
import { MILITARY_MODE } from '../../../src/systems/readviews/index.js';
import { noteUnreachableGoal } from '../../../src/systems/settlers/unreachable-goals.js';
import { testContent } from '../../fixtures/content.js';
import { grassCellMap } from '../../fixtures/terrain.js';
import { combatantAtNode, P0 } from '../stances/support.js';
import { COW, ctxOf, DEER, fighterAtNode, HUNTER } from './support.js';

/**
 * The hunter's HUNTING GROUND and prey tiering (engageSpec's hunter branch): a flag-bound hunter
 * acquires prey only within its work-flag circle (the flag anchors the chase leash), takes no new
 * target while a harvestable carcass lies in the ground (one kill at a time), and last-resort
 * livestock (huntPrey `lastResort` - the fixture cow) is taken only when no normal game (the deer) is
 * in the ground. The fixture hunter weapon `test_spear` (tribe 1, job 15) has band [3, 17].
 */
describe('combatSystem - the hunter hunting ground and prey tiers', () => {
  /** Bind `hunter` to a work flag standing on half-cell node (hx, hy). `radius` in nodes. */
  function bindFlagAtNode(sim: Simulation, hunter: Entity, hx: number, hy: number, radius: number): Entity {
    const flag = sim.world.create();
    sim.world.add(flag, Position, positionOfNode(hx, hy));
    sim.world.add(flag, DeliveryFlag, {});
    sim.world.add(hunter, WorkFlag, { flag, radius });
    return flag;
  }

  it('leaves prey OUTSIDE its flag radius alone, even inside plain sight', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    bindFlagAtNode(sim, hunter, 40, 40, 4); // a tight ground: 4 nodes around the hunter's own node
    fighterAtNode(sim, 46, 40, COW, null); // 6 nodes off - in the test_spear band, OUT of the ground

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(hunter, CurrentAtomic)).toBe(false); // no swing at out-of-ground prey
    expect(sim.world.has(hunter, Engagement)).toBe(false); // and no chase toward it
  });

  it('prefers normal game over NEARER last-resort livestock (both in the ground)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    bindFlagAtNode(sim, hunter, 40, 40, 12);
    fighterAtNode(sim, 43, 40, COW, null); // lastResort livestock, dist 3 - nearer, in the band
    const deer = fighterAtNode(sim, 45, 40, DEER, null); // normal game, dist 5 - farther, in the band

    combatSystem(sim.world, ctxOf(sim));

    // The two-tier search: normal game wins even at a distance disadvantage.
    expect(sim.world.get(hunter, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target: deer });
  });

  it('falls back to last-resort livestock when NO normal game is in the ground', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    bindFlagAtNode(sim, hunter, 40, 40, 12);
    const cow = fighterAtNode(sim, 43, 40, COW, null); // the only prey around

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(hunter, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target: cow });
  });

  it('takes NO new target while a harvestable carcass still lies in the ground', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    bindFlagAtNode(sim, hunter, 40, 40, 12);
    fighterAtNode(sim, 45, 40, DEER, null); // normal game in the band - but the hunter is not idle:
    fighterAtNode(sim, 43, 40, COW, null); // (and livestock too)
    // an unharvested carcass node (fixture meat 21, harvest_cadaver 33 - the hunter's own trade).
    const carcass = sim.world.create();
    sim.world.add(carcass, Position, positionOfNode(38, 40));
    sim.world.add(carcass, Resource, { goodType: 21, remaining: 2, harvestAtomic: 33 });

    combatSystem(sim.world, ctxOf(sim));

    // One kill at a time: carry the standing kill home before the next shot - no swing, no chase.
    expect(sim.world.has(hunter, CurrentAtomic)).toBe(false);
    expect(sim.world.has(hunter, Engagement)).toBe(false);
  });

  it('an in-ground carcass the hunter remembers as UNREACHABLE does not gate new kills', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    bindFlagAtNode(sim, hunter, 40, 40, 12);
    const cow = fighterAtNode(sim, 43, 40, COW, null);
    const carcass = sim.world.create();
    sim.world.add(carcass, Position, positionOfNode(38, 40));
    sim.world.add(carcass, Resource, { goodType: 21, remaining: 2, harvestAtomic: 33 });
    // The harvest drive's route to it just failed (an overlay-boxed kill): the memo veto must keep the
    // one-kill gate from out-claiming work nobody can bank - the hunter goes on hunting.
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('test map missing');
    noteUnreachableGoal(sim.world, ctxOf(sim), hunter, terrain.nodeAt(38, 40));

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(hunter, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target: cow });
  });
});
