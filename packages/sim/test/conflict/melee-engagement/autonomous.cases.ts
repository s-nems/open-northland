import { describe, expect, it } from 'vitest';
import {
  CurrentAtomic,
  Engagement,
  Health,
  MoveGoal,
  PathRequest,
  Position,
  Resource,
} from '../../../src/components/index.js';
import { fx, Simulation } from '../../../src/index.js';
import { combatSystem, SIGHT_RADIUS_NODES } from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';
import {
  BEAR,
  ctxOf,
  FRANK,
  fighterAt,
  grassMap,
  HARVEST_ATOMIC,
  HUNTER,
  P0,
  P1,
  splitMap,
  VIKING,
  WOOD,
  WOODCUTTER,
} from './support.js';

describe('combat hostility - the owner (player) axis', () => {
  it('two OWNED same-tribe combatants of DIFFERENT players are enemies (they fight)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const a = fighterAt(sim, 0, 0, VIKING, WOODCUTTER, { owner: P0 });
    const b = fighterAt(sim, 1, 0, VIKING, WOODCUTTER, { owner: P1 }); // adjacent, other player

    combatSystem(sim.world, ctxOf(sim));

    // Same tribe would be friendly under the tribe rule - the OWNER axis makes them enemies.
    expect(sim.world.get(a, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target: b });
    expect(sim.world.get(b, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target: a });
  });

  it('two OWNED units of the SAME player never fight (a player’s own army is friendly)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const a = fighterAt(sim, 0, 0, VIKING, WOODCUTTER, { owner: P0 });
    fighterAt(sim, 1, 0, VIKING, WOODCUTTER, { owner: P0 }); // same player, adjacent

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(a, CurrentAtomic)).toBe(false);
  });

  it('an OWNED unit and an UNOWNED same-tribe unit are neutral (owned-vs-unowned same tribe)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const owned = fighterAt(sim, 0, 0, VIKING, WOODCUTTER, { owner: P0 });
    const neutral = fighterAt(sim, 1, 0, VIKING, WOODCUTTER); // no owner - belongs to nobody

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(owned, CurrentAtomic)).toBe(false); // the owned unit leaves the neutral alone
    expect(sim.world.has(neutral, CurrentAtomic)).toBe(false); // and vice-versa
  });

  it('the owner axis is authoritative for an owned-vs-owned pair - it overrides the animal relations', () => {
    // An aggressive BEAR would normally attack a nearby viking. But when BOTH are owned, the player axis
    // alone decides: same player → friendly (no attack); different player → enemies (they fight).
    const same = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const bearSame = fighterAt(same, 0, 0, BEAR, null, { owner: P0 });
    fighterAt(same, 1, 0, VIKING, WOODCUTTER, { owner: P0 });
    combatSystem(same.world, ctxOf(same));
    expect(same.world.has(bearSame, CurrentAtomic)).toBe(false); // same player - the bear holds its swing

    const diff = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const bearDiff = fighterAt(diff, 0, 0, BEAR, null, { owner: P0 });
    const vikingDiff = fighterAt(diff, 1, 0, VIKING, WOODCUTTER, { owner: P1 });
    combatSystem(diff.world, ctxOf(diff));
    expect(diff.world.get(bearDiff, CurrentAtomic).effect).toMatchObject({
      kind: 'attack',
      target: vikingDiff,
    });
  });
});

describe('walk-into-melee - an OWNED combatant advances on a spotted enemy', () => {
  it('chases an enemy beyond weapon reach but within sight (a MoveGoal + Engagement, no swing yet)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(10, 1) });
    const a = fighterAt(sim, 0, 0, VIKING, WOODCUTTER, { owner: P0 });
    fighterAt(sim, 5, 0, VIKING, WOODCUTTER, { owner: P1 }); // 10 nodes away - beyond axe band [1,2], inside sight

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(a, CurrentAtomic)).toBe(false); // out of reach - no swing this tick
    expect(sim.world.has(a, Engagement)).toBe(true); // it is engaged (advancing)
    expect(sim.world.has(a, MoveGoal)).toBe(true);
    // The chase aims at an approach node in the enemy's reach band closest to the unit - 2 nodes short of
    // the enemy at node (10, 0), so the unit stops adjacent-ish rather than walking onto it.
    expect(sim.terrain?.coordsOf(sim.world.get(a, MoveGoal).cell)).toEqual({ x: 8, y: 0 });
  });

  it('an UNOWNED combatant does NOT advance (swing-in-place only - unchanged behaviour)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(10, 1) });
    const a = fighterAt(sim, 0, 0, VIKING, WOODCUTTER); // unowned
    fighterAt(sim, 5, 0, FRANK, WOODCUTTER); // unowned enemy, beyond reach

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(a, CurrentAtomic)).toBe(false);
    expect(sim.world.has(a, Engagement)).toBe(false); // no advance drive for an unowned unit
    expect(sim.world.has(a, MoveGoal)).toBe(false);
  });

  it('an UNOWNED combatant swinging IN RANGE carries no Engagement (unowned byte-identity)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const a = fighterAt(sim, 0, 0, VIKING, WOODCUTTER); // unowned
    const enemy = fighterAt(sim, 1, 0, FRANK, WOODCUTTER); // unowned enemy, adjacent (in the axe band)

    combatSystem(sim.world, ctxOf(sim));

    // It swings (the tribe-hostility fight is unchanged) but is NOT marked engaged - the Engagement stamp
    // is owned-only, so an unowned combatant's state stays byte-identical to the pre-engagement code.
    expect(sim.world.get(a, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target: enemy });
    expect(sim.world.has(a, Engagement)).toBe(false);
  });

  it('does NOT engage an enemy beyond the sight radius', () => {
    const far = SIGHT_RADIUS_NODES / 2 + 1; // cells - a same-row cell is 2 nodes, so node distance SIGHT+2
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(far + 2, 1) });
    const a = fighterAt(sim, 0, 0, VIKING, WOODCUTTER, { owner: P0 });
    fighterAt(sim, far, 0, VIKING, WOODCUTTER, { owner: P1 }); // beyond sight

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(a, Engagement)).toBe(false);
    expect(sim.world.has(a, MoveGoal)).toBe(false);
    expect(sim.world.has(a, CurrentAtomic)).toBe(false);
  });

  it('releases an enemy it cannot reach and goes back to work', () => {
    // The stance twin of the attack-move case: an enemy well inside sight but across an unswimmable column,
    // so no cell an axe could strike it from is one this fighter can stand on.
    const sim = new Simulation({ seed: 1, content: testContent(), map: splitMap(14, 5, 6) });
    fighterAt(sim, 2, 2, VIKING, WOODCUTTER, { owner: P0 });
    fighterAt(sim, 9, 2, VIKING, WOODCUTTER, { owner: P1 }); // 14 nodes off, inside SIGHT_RADIUS_NODES
    const wood = sim.world.create(); // work waiting on its own bank
    sim.world.add(wood, Position, { x: fx.fromInt(3), y: fx.fromInt(2) });
    sim.world.add(wood, Resource, { goodType: WOOD, remaining: 100, harvestAtomic: HARVEST_ATOMIC });

    sim.run(62); // the walk out, then the first swings of the harvest

    // Every idle moment between atomics re-acquires the enemy across the water: without the release the
    // chase re-benches the woodcutter each time and the tree is never touched.
    expect(sim.world.get(wood, Resource).remaining).toBeLessThan(100);
  });

  it('asks for no route at all toward the far bank', () => {
    // Counted probe: navigationPlanner turns a goal into exactly one PathRequest, so a request standing
    // after the planner pass is a route this fighter asked for. It should ask for none across the water:
    // the contact cell is in another static component, which is decided from the graph, not by searching.
    const sim = new Simulation({ seed: 1, content: testContent(), map: splitMap(14, 5, 6) });
    const a = fighterAt(sim, 2, 2, VIKING, WOODCUTTER, { owner: P0 });
    fighterAt(sim, 9, 2, VIKING, WOODCUTTER, { owner: P1 });
    const bank = sim.terrain?.componentOf(sim.terrain.nodeAt(2 * 2, 2 * 2));
    let farBankRequests = 0;
    sim.setInstrument((name, run) => {
      run();
      const goal = name === 'planner' ? sim.world.tryGet(a, PathRequest)?.goal : undefined;
      if (goal !== undefined && sim.terrain?.componentOf(goal) !== bank) farBankRequests++;
    });

    for (let i = 0; i < 200; i++) sim.step();

    expect(farBankRequests).toBe(0);
    // Nor does the marker ever survive a tick boundary, which is the state the planner and the snapshot read.
    expect(sim.world.has(a, Engagement)).toBe(false);
  });

  it('still shoots across the water it cannot walk across', () => {
    // Unreachability refuses the WALK, never the swing: a bow reaches over the column (4 nodes, inside its
    // [3, 17] band), so the archer's own cell is a firing cell and the far bank is still a target.
    const sim = new Simulation({ seed: 1, content: testContent(), map: splitMap(14, 5, 6) });
    const a = fighterAt(sim, 5, 2, VIKING, HUNTER, { owner: P0 });
    const enemy = fighterAt(sim, 7, 2, VIKING, WOODCUTTER, { owner: P1 });

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(a, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target: enemy });
  });

  it('falls through to a reachable enemy farther out instead of re-picking the near one across water', () => {
    // The near enemy's whole axe band lies on the far bank, so it is no candidate at all and the
    // nearest-first search reaches the one this fighter can close on.
    const sim = new Simulation({ seed: 1, content: testContent(), map: splitMap(14, 12, 6) });
    const a = fighterAt(sim, 5, 2, VIKING, WOODCUTTER, { owner: P0 }); // node (10, 4), hugging the water
    fighterAt(sim, 7, 2, VIKING, WOODCUTTER, { owner: P1 }); // node (14, 4) - 4 nodes off, over the column
    fighterAt(sim, 5, 5, VIKING, WOODCUTTER, { owner: P1 }); // node (11, 10) - 7 nodes off, same bank

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(a, Engagement)).toBe(true);
    // It walks to a contact cell of the SAME-BANK enemy, 2 nodes short of its node (11, 10).
    expect(sim.terrain?.coordsOf(sim.world.get(a, MoveGoal).cell)).toEqual({ x: 11, y: 8 });
  });

  it('still chases an enemy on its own bank - the release is unreachable-only', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: splitMap(14, 5, 6) });
    const a = fighterAt(sim, 2, 2, VIKING, WOODCUTTER, { owner: P0, hitpoints: 1_000_000 });
    const enemy = fighterAt(sim, 5, 2, VIKING, WOODCUTTER, { owner: P1, hitpoints: 1_000_000 });

    sim.run(200);

    expect(sim.world.has(a, Engagement)).toBe(true);
    expect(sim.world.get(enemy, Health).hitpoints).toBeLessThan(1_000_000); // it closed and struck
  });

  it('advances into contact and lands blows through the real step() schedule', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(12, 1) });
    const a = fighterAt(sim, 0, 0, VIKING, WOODCUTTER, { owner: P0, hitpoints: 1_000_000 });
    const b = fighterAt(sim, 6, 0, VIKING, WOODCUTTER, { owner: P1, hitpoints: 1_000_000 }); // 12 nodes apart

    for (let i = 0; i < 200; i++) sim.step();

    // They closed the gap (both sides advanced) and are trading blows - at least one HP pool has fallen.
    const aHurt = sim.world.get(a, Health).hitpoints < 1_000_000;
    const bHurt = sim.world.get(b, Health).hitpoints < 1_000_000;
    expect(aHurt || bHurt).toBe(true);
  });
});
