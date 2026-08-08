import { describe, expect, it } from 'vitest';
import {
  AttackOrder,
  Carrying,
  CurrentAtomic,
  DeliveryFlag,
  Engagement,
  Health,
  HuntFocus,
  HuntRest,
  KilledBy,
  Position,
  Resource,
  Stance,
  WorkFlag,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { checkInvariants, halfCellMapFromCells, positionOfNode, Simulation } from '../../../src/index.js';
import {
  HUNT_LAST_RESORT_SCAN_FACTOR,
  HUNT_SEARCH_REST_TICKS,
} from '../../../src/systems/conflict/hunting/index.js';
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
 * in the ground NOR in the wider probe around it. Once it has drawn on an animal it stays on THAT one
 * (the `HuntFocus` lock) out to the leash, so a bolting kill is run down instead of traded for whatever
 * grazes nearest.
 * The fixture hunter weapon `test_spear` (tribe 1, job 15) has band [3, 17].
 */
/** The fixture meat good and its harvest_cadaver atomic - the hunter's own trade (granted to job 15). */
const MEAT = 21;
const HARVEST_CADAVER = 33;
/** Fixture ground types (`economy.ts` landscapes): grass walks, water does not. */
const GRASS = 0;
const WATER = 1;

describe('combatSystem - the hunter hunting ground and prey tiers', () => {
  /** Bind `hunter` to a work flag standing on half-cell node (hx, hy). `radius` in nodes. */
  function bindFlagAtNode(sim: Simulation, hunter: Entity, hx: number, hy: number, radius: number): Entity {
    const flag = sim.world.create();
    sim.world.add(flag, Position, positionOfNode(hx, hy));
    sim.world.add(flag, DeliveryFlag, {});
    sim.world.add(hunter, WorkFlag, { flag, radius });
    return flag;
  }

  /** Teleport `e` onto half-cell node (hx, hy) - a prey animal bolting, without running the mover. */
  function moveToNode(sim: Simulation, e: Entity, hx: number, hy: number): void {
    sim.world.write(e, Position, (p) => {
      const at = positionOfNode(hx, hy);
      p.x = at.x;
      p.y = at.y;
    });
  }

  /** Stand a hunter that has just loosed a shot back up: the draw atomic has played out, so it is free
   *  to act again on the next combat pass. */
  function drawFinished(sim: Simulation, hunter: Entity): void {
    sim.world.remove(hunter, CurrentAtomic);
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

  it('falls back to last-resort livestock when NO normal game is left anywhere around', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    bindFlagAtNode(sim, hunter, 40, 40, 12);
    const cow = fighterAtNode(sim, 43, 40, COW, null); // the only prey around

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(hunter, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target: cow });
  });

  it('leaves the herd alone while normal game stands BEYOND the ground - the complete last resort', () => {
    const RADIUS = 12;
    const PROBE = RADIUS * HUNT_LAST_RESORT_SCAN_FACTOR;
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    bindFlagAtNode(sim, hunter, 40, 40, RADIUS);
    const cow = fighterAtNode(sim, 43, 40, COW, null); // the only prey IN the ground
    const deer = fighterAtNode(sim, 40 + PROBE - 4, 40, DEER, null); // past the ground, inside the probe

    combatSystem(sim.world, ctxOf(sim));

    // Real game is still around, so the settlement's herd is not the last resort yet: the hunter waits
    // to be re-posted rather than shooting stock a shrunken ground happens to sit on (user report
    // 2026-08-03). The empty search rests, so the second pass runs once the breather has lapsed.
    expect(sim.world.has(hunter, CurrentAtomic)).toBe(false);
    expect(sim.world.has(hunter, Engagement)).toBe(false);
    expect(sim.world.has(hunter, HuntRest)).toBe(true);

    moveToNode(sim, deer, 40 + PROBE + 6, 40); // the last real game leaves the probe
    combatSystem(sim.world, { ...ctxOf(sim), tick: HUNT_SEARCH_REST_TICKS });

    expect(sim.world.get(hunter, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target: cow });
  });

  it('sees game the wider probe reaches but the acquisition band never did', () => {
    // The probe runs from inside the acquisition search's own `accept`, so it re-enters the ring search
    // with a wider radius. Placed so the deer sits in a coarse index cell (32 nodes wide) the outer
    // search never touches: the nested walk has to reach it on its own.
    const RADIUS = 20;
    const HUNTER_NODE = 30;
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const hunter = combatantAtNode(sim, HUNTER_NODE, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    bindFlagAtNode(sim, hunter, HUNTER_NODE, 40, RADIUS);
    const cow = fighterAtNode(sim, HUNTER_NODE + 3, 40, COW, null); // the only prey IN the ground
    const deer = fighterAtNode(sim, HUNTER_NODE + RADIUS + 16, 40, DEER, null); // past the ground, in the probe

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(hunter, CurrentAtomic)).toBe(false); // real game around - the herd is safe
    expect(sim.world.has(hunter, HuntRest)).toBe(true);

    moveToNode(sim, deer, HUNTER_NODE + RADIUS * HUNT_LAST_RESORT_SCAN_FACTOR + 6, 40);
    combatSystem(sim.world, { ...ctxOf(sim), tick: HUNT_SEARCH_REST_TICKS });

    expect(sim.world.get(hunter, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target: cow });
  });

  it("counts a COLLEAGUE's committed animal as game around - one hunter's hold spares the herd", () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const first = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    const second = combatantAtNode(sim, 40, 42, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    bindFlagAtNode(sim, first, 40, 40, 12);
    bindFlagAtNode(sim, second, 40, 42, 12);
    const deer = fighterAtNode(sim, 45, 40, DEER, null); // the only normal game, and both can reach it
    fighterAtNode(sim, 43, 42, COW, null); // in the second hunter's ground, and no colleague wants it

    combatSystem(sim.world, ctxOf(sim));

    // The colleague's hold takes the deer off the second hunter's candidates (one hunter per animal),
    // but it is still game standing in its probe - so the cow stays livestock, not the next-best meat.
    expect(sim.world.get(first, HuntFocus).target).toBe(deer);
    expect(sim.world.has(second, HuntFocus)).toBe(false);
    expect(sim.world.has(second, CurrentAtomic)).toBe(false);
  });

  it('takes NO new target while a harvestable carcass still lies in the ground', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    bindFlagAtNode(sim, hunter, 40, 40, 12);
    fighterAtNode(sim, 45, 40, DEER, null); // normal game in the band - but the hunter is not idle:
    fighterAtNode(sim, 43, 40, COW, null); // (and livestock too)
    const carcass = sim.world.create(); // an unharvested carcass node of the hunter's own trade
    sim.world.add(carcass, Position, positionOfNode(38, 40));
    sim.world.add(carcass, Resource, { goodType: MEAT, remaining: 2, harvestAtomic: HARVEST_CADAVER });

    combatSystem(sim.world, ctxOf(sim));

    // One kill at a time: carry the standing kill home before the next shot - no swing, no chase.
    expect(sim.world.has(hunter, CurrentAtomic)).toBe(false);
    expect(sim.world.has(hunter, Engagement)).toBe(false);
  });

  it('takes NO new target while CARRYING a load - the kill is fully banked before the next shot', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    bindFlagAtNode(sim, hunter, 40, 40, 12);
    fighterAtNode(sim, 45, 40, DEER, null); // fresh game in the band - but the meat on the back comes first
    // The last pickup's load: the carcass node is gone, only the carry leg remains.
    sim.world.add(hunter, Carrying, { goodType: MEAT, amount: 1 });

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(hunter, CurrentAtomic)).toBe(false);
    expect(sim.world.has(hunter, Engagement)).toBe(false);
  });

  it("an explicit ATTACK ORDER pierces the carrying veto - the player's order is authoritative", () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    bindFlagAtNode(sim, hunter, 40, 40, 12);
    const cow = fighterAtNode(sim, 43, 40, COW, null);
    sim.world.add(hunter, Carrying, { goodType: MEAT, amount: 1 });
    sim.world.add(hunter, AttackOrder, { target: cow });

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(hunter, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target: cow });
  });

  it('rests after an EMPTY search (HuntRest), then re-acquires once the breather lapses', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    bindFlagAtNode(sim, hunter, 40, 40, 4); // a tight ground
    // Prey on the map (so the dormancy gate wakes combat at all) but OUT of the ground: the hunter's
    // full-band search comes up empty.
    const cow = fighterAtNode(sim, 46, 40, COW, null);

    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(hunter, HuntRest)).toBe(true); // the empty search stamped the breather

    // The cow steps INTO the ground mid-breather: still resting, the search is skipped.
    sim.world.write(cow, Position, (p) => {
      const inGround = positionOfNode(43, 40);
      p.x = inGround.x;
      p.y = inGround.y;
    });
    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(hunter, CurrentAtomic)).toBe(false);

    combatSystem(sim.world, { ...ctxOf(sim), tick: HUNT_SEARCH_REST_TICKS });
    expect(sim.world.has(hunter, HuntRest)).toBe(false); // the lapsed breather is reaped on read
    expect(sim.world.get(hunter, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target: cow });
  });

  it('a carcass fallen just PAST the flag radius (the kill slack) still gates - and still gets banked', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    bindFlagAtNode(sim, hunter, 40, 40, 4); // a tight ground
    fighterAtNode(sim, 43, 40, COW, null); // prey in the band - must wait for the banking
    // A kill the chase leash permitted, fallen 2 nodes past the radius: inside the slack band.
    const carcass = sim.world.create();
    sim.world.add(carcass, Position, positionOfNode(46, 40));
    sim.world.add(carcass, Resource, { goodType: MEAT, remaining: 1, harvestAtomic: HARVEST_CADAVER });

    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(hunter, CurrentAtomic)).toBe(false); // the out-of-radius carcass still gates
    expect(sim.world.has(hunter, Engagement)).toBe(false);

    // ... and the harvest drive's reach covers the slack band too: the meat ends up on the back,
    // never stranded past an invisible line.
    let guard = 600;
    while (!sim.world.has(hunter, Carrying) && guard-- > 0) sim.step();
    expect(sim.world.tryGet(hunter, Carrying)?.goodType).toBe(MEAT);
  });

  it('stays on the animal it drew on, following it PAST the flag circle, while a nearer one grazes', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    bindFlagAtNode(sim, hunter, 40, 40, 12); // ground radius 12, so the chase leash reaches 16
    const wounded = fighterAtNode(sim, 45, 40, DEER, null); // dist 5 - squarely in the band

    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(hunter, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target: wounded });

    // The shot scatters the herd: the struck deer bolts to node 55 - out of the flag circle (15 > 12)
    // but inside the leash - while an untouched one wanders into easy reach.
    drawFinished(sim, hunter);
    moveToNode(sim, wounded, 55, 40);
    fighterAtNode(sim, 44, 40, DEER, null); // dist 4 - nearer, in the band, in the ground

    combatSystem(sim.world, { ...ctxOf(sim), tick: 1 });

    // The lock holds: the second arrow goes after the wounded animal, not the convenient one.
    expect(sim.world.get(hunter, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target: wounded });
    expect(sim.world.get(hunter, HuntFocus).target).toBe(wounded);
  });

  it('gives the animal up once it outruns the chase leash, and takes the game still in the ground', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    bindFlagAtNode(sim, hunter, 40, 40, 12);
    const escaped = fighterAtNode(sim, 45, 40, DEER, null);

    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(hunter, HuntFocus).target).toBe(escaped);

    // 18 nodes from the flag - past the leash (16). The commitment is not a licence to leave the ground.
    drawFinished(sim, hunter);
    moveToNode(sim, escaped, 58, 40);
    const nearby = fighterAtNode(sim, 44, 40, DEER, null);

    combatSystem(sim.world, { ...ctxOf(sim), tick: 1 });

    expect(sim.world.get(hunter, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target: nearby });
    expect(sim.world.get(hunter, HuntFocus).target).toBe(nearby);
  });

  it('gives the animal up when it drops - the lock never outlives its prey', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    bindFlagAtNode(sim, hunter, 40, 40, 12);
    const felled = fighterAtNode(sim, 45, 40, DEER, null);

    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(hunter, HuntFocus).target).toBe(felled);

    drawFinished(sim, hunter);
    sim.world.write(felled, Health, (h) => {
      h.hitpoints = 0;
    });
    const next = fighterAtNode(sim, 43, 40, DEER, null);

    combatSystem(sim.world, { ...ctxOf(sim), tick: 1 });

    expect(sim.world.get(hunter, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target: next });
    expect(sim.world.get(hunter, HuntFocus).target).toBe(next);
  });

  it('a hold on LAST-RESORT livestock still yields to normal game that walks in', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    bindFlagAtNode(sim, hunter, 40, 40, 12);
    const cow = fighterAtNode(sim, 43, 40, COW, null); // the only prey - taken as the last resort

    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(hunter, HuntFocus).target).toBe(cow);

    // The tier rule outranks the commitment: a deer in the ground wins even though the cow is nearer
    // and already wounded - the hunter keeps its herd for husbandry while real game is on offer.
    drawFinished(sim, hunter);
    const deer = fighterAtNode(sim, 46, 40, DEER, null);

    combatSystem(sim.world, { ...ctxOf(sim), tick: 1 });

    expect(sim.world.get(hunter, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target: deer });
    expect(sim.world.get(hunter, HuntFocus).target).toBe(deer);
  });

  it('sheds the hold when the hunter stops hunting - it never outlives the engagement', () => {
    for (const mode of [MILITARY_MODE.FLEE, MILITARY_MODE.DEFEND] as const) {
      const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
      const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
      bindFlagAtNode(sim, hunter, 40, 40, 12);
      const deer = fighterAtNode(sim, 45, 40, DEER, null);

      combatSystem(sim.world, ctxOf(sim));
      expect(sim.world.get(hunter, HuntFocus).target).toBe(deer);

      // The player re-tasks the hunter. Nothing but the hunting branch can reap the hold, so a stance
      // that no longer runs it must shed the hold itself or a dead animal id rides the state hash on.
      drawFinished(sim, hunter);
      sim.world.write(hunter, Stance, (s) => {
        s.mode = mode;
      });
      combatSystem(sim.world, { ...ctxOf(sim), tick: 1 });

      expect(sim.world.has(hunter, HuntFocus), `mode ${mode}`).toBe(false);
      expect(checkInvariants(sim.world, sim.content), `mode ${mode}`).toEqual([]);
    }
  });

  it('never takes game across a static terrain seam - unreachable prey is not its game', () => {
    // A full-height water column at cell x=22 (nodes 44..45) splits the map: the hunter's bank and the
    // deer's are different terrain components, so no route between them can ever resolve.
    const width = 64;
    const height = 64;
    const typeIds = new Array(width * height).fill(GRASS);
    for (let y = 0; y < height; y++) typeIds[y * width + 22] = WATER;
    const sim = new Simulation({
      seed: 1,
      content: testContent(),
      map: halfCellMapFromCells({ width, height, typeIds }),
    });
    const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    bindFlagAtNode(sim, hunter, 40, 40, 12);
    fighterAtNode(sim, 48, 40, DEER, null); // 8 nodes off and inside the ground - but over the water

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(hunter, CurrentAtomic)).toBe(false);
    expect(sim.world.has(hunter, HuntFocus)).toBe(false);
    expect(sim.world.has(hunter, HuntRest)).toBe(true); // the search came up empty, so it rests
  });

  it('an UNPOSTED hunter (no flag, no workplace) holds its prey out to plain sight', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    const wounded = fighterAtNode(sim, 45, 40, DEER, null); // no work flag: the hunt is sight-bound

    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(hunter, HuntFocus).target).toBe(wounded);

    drawFinished(sim, hunter);
    moveToNode(sim, wounded, 55, 40); // 15 nodes off - inside the spear's band and plain sight
    fighterAtNode(sim, 44, 40, DEER, null);

    combatSystem(sim.world, { ...ctxOf(sim), tick: 1 });

    expect(sim.world.get(hunter, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target: wounded });
  });

  it('drops the lock for a carcass that appears mid-chase - one kill at a time still wins', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    bindFlagAtNode(sim, hunter, 40, 40, 12);
    const wounded = fighterAtNode(sim, 45, 40, DEER, null);

    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(hunter, HuntFocus).target).toBe(wounded);

    // An earlier kill of the hunter's own trade is lying in the ground: the meat comes home first.
    drawFinished(sim, hunter);
    const carcass = sim.world.create();
    sim.world.add(carcass, Position, positionOfNode(38, 40));
    sim.world.add(carcass, Resource, { goodType: MEAT, remaining: 2, harvestAtomic: HARVEST_CADAVER });

    combatSystem(sim.world, { ...ctxOf(sim), tick: 1 });

    expect(sim.world.has(hunter, HuntFocus)).toBe(false);
    expect(sim.world.has(hunter, CurrentAtomic)).toBe(false);
    expect(sim.world.has(hunter, Engagement)).toBe(false);
  });

  it('two hunters sharing a ground draw on DIFFERENT animals', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const first = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    const second = combatantAtNode(sim, 40, 42, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    bindFlagAtNode(sim, first, 40, 40, 12);
    bindFlagAtNode(sim, second, 40, 42, 12);
    // Both deer are in both hunters' bands, and this one is the nearer of the two for BOTH of them.
    const nearest = fighterAtNode(sim, 45, 41, DEER, null);
    const other = fighterAtNode(sim, 48, 41, DEER, null);

    combatSystem(sim.world, ctxOf(sim));

    // The colleague's committed animal is no candidate, so the herd is split rather than doubled up on.
    expect(sim.world.get(first, HuntFocus).target).toBe(nearest);
    expect(sim.world.get(second, HuntFocus).target).toBe(other);
    expect(sim.world.get(second, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target: other });
  });

  it("a COLLEAGUE's kill neither gates this hunter's hunting nor is left ownerless when its killer dies", () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    const colleague = combatantAtNode(sim, 41, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    bindFlagAtNode(sim, hunter, 40, 40, 12);
    bindFlagAtNode(sim, colleague, 41, 40, 12); // overlapping grounds - the carcass lies in both
    const deer = fighterAtNode(sim, 45, 40, DEER, null);
    const carcass = sim.world.create();
    sim.world.add(carcass, Position, positionOfNode(38, 40));
    sim.world.add(carcass, Resource, { goodType: MEAT, remaining: 2, harvestAtomic: HARVEST_CADAVER });
    sim.world.add(carcass, KilledBy, { by: colleague });

    combatSystem(sim.world, ctxOf(sim));

    // The one-kill gate is per hunter, not per ground: the colleague's body is not this hunter's work.
    expect(sim.world.get(hunter, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target: deer });

    // The claim dies with its killer, or no kill made by a hunter that falls could ever be banked.
    sim.world.destroy(colleague);
    sim.world.remove(hunter, CurrentAtomic);
    sim.world.remove(hunter, HuntFocus);

    combatSystem(sim.world, { ...ctxOf(sim), tick: 1 });

    expect(sim.world.has(hunter, CurrentAtomic)).toBe(false); // gated again - the body is now its own work
    expect(sim.world.has(hunter, Engagement)).toBe(false);
  });

  it('an in-ground carcass the hunter remembers as UNREACHABLE does not gate new kills', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(64, 64) });
    const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    bindFlagAtNode(sim, hunter, 40, 40, 12);
    const cow = fighterAtNode(sim, 43, 40, COW, null);
    const carcass = sim.world.create();
    sim.world.add(carcass, Position, positionOfNode(38, 40));
    sim.world.add(carcass, Resource, { goodType: MEAT, remaining: 2, harvestAtomic: HARVEST_CADAVER });
    // The harvest drive's route to it just failed (an overlay-boxed kill): the memo veto must keep the
    // one-kill gate from out-claiming work nobody can bank - the hunter goes on hunting.
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('test map missing');
    noteUnreachableGoal(sim.world, ctxOf(sim), hunter, terrain.nodeAt(38, 40));

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(hunter, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target: cow });
  });
});
