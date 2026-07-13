import { beforeEach, describe, expect, it } from 'vitest';
import {
  AttackOrder,
  CurrentAtomic,
  Engagement,
  Health,
  MoveGoal,
  Owner,
  PathFollow,
  PathRequest,
  PlayerOrder,
  Position,
  Resource,
  Settler,
  Stance,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { clearComponentStores } from '../../src/harness/stores.js';
import { cellAnchorNode, fx, halfCellMapFromCells, Simulation, type TerrainMap } from '../../src/index.js';
import { aiSystem, combatSystem, SIGHT_RADIUS_NODES, type SystemContext } from '../../src/systems/index.js';
import { attackUnit, moveUnit } from '../../src/systems/orders/index.js';
import { MILITARY_MODE } from '../../src/systems/readviews/index.js';
import { testContent } from '../fixtures/content.js';

/**
 * The **engagement half** of combat: the owner-based hostility axis, the walk-into-melee advance
 * (an OWNED combatant chases a spotted enemy and swings on arrival), and the explicit `attackUnit`
 * order. The existing combat-system.test.ts pins the swing-in-place targeting (unowned, tribe/animal
 * hostility) unchanged; this file pins what OWNED combatants add on top.
 *
 * The fixture's `test_axe` (viking tribe 1, job 1) has band `[1, 2]`, damage 50 vs unarmored.
 */

const GRASS = 0;
const WOOD = 1;
const HARVEST_ATOMIC = 24;
const VIKING = 1; // tribe 1 — test_axe for job 1
const FRANK = 2; // a different tribe with NO fixture record (a valid civ enemy, no weapon)
const BEAR = 10; // an AGGRESSIVE animal tribe (test_bearfist for job 1)
const WOODCUTTER = 1;
const P0 = 0;
const P1 = 1;

beforeEach(() => {
  clearComponentStores();
});

function grassMap(width: number, height: number): TerrainMap {
  return halfCellMapFromCells({ width, height, typeIds: new Array(width * height).fill(GRASS) });
}

function ctxOf(sim: Simulation): SystemContext {
  return {
    content: sim.content,
    rng: sim.rng,
    tick: sim.tick,
    events: sim.events,
    ...(sim.terrain !== undefined ? { terrain: sim.terrain } : {}),
  };
}

/** A combatant (Settler + Health). `owner` (a player slot) stamps an Owner; omit for a neutral unit. */
function fighterAt(
  sim: Simulation,
  x: number,
  y: number,
  tribe: number,
  jobType: number | null,
  opts: { hitpoints?: number; owner?: number } = {},
): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Settler, {
    tribe,
    jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map(),
  });
  sim.world.add(e, Health, { hitpoints: opts.hitpoints ?? 1000, max: opts.hitpoints ?? 1000 });
  if (opts.owner !== undefined) {
    sim.world.add(e, Owner, { player: opts.owner });
    // These OWNED test units are aggressive combatants — an explicit ATTACK stance (they spawn via a direct
    // world.add here, not the spawnSettler command, so the job-default stamp doesn't run; the fixture's job
    // 1 is a woodcutter, which would otherwise default to FLEE and make them run instead of fight).
    sim.world.add(e, Stance, { mode: MILITARY_MODE.ATTACK, anchorCell: null });
  }
  return e;
}

describe('combat hostility — the owner (player) axis', () => {
  it('two OWNED same-tribe combatants of DIFFERENT players are enemies (they fight)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const a = fighterAt(sim, 0, 0, VIKING, WOODCUTTER, { owner: P0 });
    const b = fighterAt(sim, 1, 0, VIKING, WOODCUTTER, { owner: P1 }); // adjacent, other player

    combatSystem(sim.world, ctxOf(sim));

    // Same tribe would be friendly under the tribe rule — the OWNER axis makes them enemies.
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
    const neutral = fighterAt(sim, 1, 0, VIKING, WOODCUTTER); // no owner — belongs to nobody

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(owned, CurrentAtomic)).toBe(false); // the owned unit leaves the neutral alone
    expect(sim.world.has(neutral, CurrentAtomic)).toBe(false); // and vice-versa
  });

  it('the owner axis is authoritative for an owned-vs-owned pair — it overrides the animal relations', () => {
    // An aggressive BEAR would normally attack a nearby viking. But when BOTH are owned, the player axis
    // alone decides: same player → friendly (no attack); different player → enemies (they fight).
    const same = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const bearSame = fighterAt(same, 0, 0, BEAR, WOODCUTTER, { owner: P0 });
    fighterAt(same, 1, 0, VIKING, WOODCUTTER, { owner: P0 });
    combatSystem(same.world, ctxOf(same));
    expect(same.world.has(bearSame, CurrentAtomic)).toBe(false); // same player — the bear holds its swing

    clearComponentStores();
    const diff = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const bearDiff = fighterAt(diff, 0, 0, BEAR, WOODCUTTER, { owner: P0 });
    const vikingDiff = fighterAt(diff, 1, 0, VIKING, WOODCUTTER, { owner: P1 });
    combatSystem(diff.world, ctxOf(diff));
    expect(diff.world.get(bearDiff, CurrentAtomic).effect).toMatchObject({
      kind: 'attack',
      target: vikingDiff,
    });
  });
});

describe('walk-into-melee — an OWNED combatant advances on a spotted enemy', () => {
  it('chases an enemy beyond weapon reach but within sight (a MoveGoal + Engagement, no swing yet)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(10, 1) });
    const a = fighterAt(sim, 0, 0, VIKING, WOODCUTTER, { owner: P0 });
    fighterAt(sim, 5, 0, VIKING, WOODCUTTER, { owner: P1 }); // 10 nodes away — beyond axe band [1,2], inside sight

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(a, CurrentAtomic)).toBe(false); // out of reach — no swing this tick
    expect(sim.world.has(a, Engagement)).toBe(true); // it is engaged (advancing)
    expect(sim.world.has(a, MoveGoal)).toBe(true);
    // The chase aims at an approach node in the enemy's reach band closest to the unit — 2 nodes short of
    // the enemy at node (10, 0), so the unit stops adjacent-ish rather than walking onto it.
    expect(sim.terrain?.coordsOf(sim.world.get(a, MoveGoal).cell)).toEqual({ x: 8, y: 0 });
  });

  it('an UNOWNED combatant does NOT advance (swing-in-place only — unchanged behaviour)', () => {
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

    // It swings (the tribe-hostility fight is unchanged) but is NOT marked engaged — the Engagement stamp
    // is owned-only, so an unowned combatant's state stays byte-identical to the pre-engagement code.
    expect(sim.world.get(a, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target: enemy });
    expect(sim.world.has(a, Engagement)).toBe(false);
  });

  it('does NOT engage an enemy beyond the sight radius', () => {
    const far = SIGHT_RADIUS_NODES / 2 + 1; // cells — a same-row cell is 2 nodes, so node distance SIGHT+2
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(far + 2, 1) });
    const a = fighterAt(sim, 0, 0, VIKING, WOODCUTTER, { owner: P0 });
    fighterAt(sim, far, 0, VIKING, WOODCUTTER, { owner: P1 }); // beyond sight

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(a, Engagement)).toBe(false);
    expect(sim.world.has(a, MoveGoal)).toBe(false);
    expect(sim.world.has(a, CurrentAtomic)).toBe(false);
  });

  it('advances into contact and lands blows through the real step() schedule', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(12, 1) });
    const a = fighterAt(sim, 0, 0, VIKING, WOODCUTTER, { owner: P0, hitpoints: 1_000_000 });
    const b = fighterAt(sim, 6, 0, VIKING, WOODCUTTER, { owner: P1, hitpoints: 1_000_000 }); // 12 nodes apart

    for (let i = 0; i < 200; i++) sim.step();

    // They closed the gap (both sides advanced) and are trading blows — at least one HP pool has fallen.
    const aHurt = sim.world.get(a, Health).hitpoints < 1_000_000;
    const bHurt = sim.world.get(b, Health).hitpoints < 1_000_000;
    expect(aHurt || bHurt).toBe(true);
  });
});

describe('attackUnit — the explicit attack order', () => {
  it('stamps an AttackOrder + Engagement and chases the target REGARDLESS of sight radius', () => {
    const far = SIGHT_RADIUS_NODES / 2 + 3; // cells — node distance SIGHT+6, beyond auto-engage sight
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(far + 2, 1) });
    const a = fighterAt(sim, 0, 0, VIKING, WOODCUTTER, { owner: P0 });
    const enemy = fighterAt(sim, far, 0, VIKING, WOODCUTTER, { owner: P1 }); // beyond auto-engage sight

    sim.enqueue({ kind: 'attackUnit', entity: a, target: enemy });
    sim.step();

    expect(sim.world.get(a, AttackOrder).target).toBe(enemy);
    expect(sim.world.has(a, Engagement)).toBe(true);
    // It is advancing on the far target (auto-engagement would have ignored an out-of-sight enemy).
    const travelling =
      sim.world.has(a, MoveGoal) || sim.world.has(a, PathRequest) || sim.world.has(a, PathFollow);
    expect(travelling).toBe(true);
  });

  it('drops the order and disengages once the target dies', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const a = fighterAt(sim, 0, 0, VIKING, WOODCUTTER, { owner: P0, hitpoints: 1_000_000 });
    const enemy = fighterAt(sim, 1, 0, VIKING, WOODCUTTER, { owner: P1, hitpoints: 80 }); // frail, adjacent

    sim.enqueue({ kind: 'attackUnit', entity: a, target: enemy });
    for (let i = 0; i < 60 && sim.world.isAlive(enemy); i++) sim.step();

    expect(sim.world.isAlive(enemy)).toBe(false); // felled under the focused attack
    expect(sim.world.has(a, AttackOrder)).toBe(false); // order dropped — no target left
    expect(sim.world.has(a, Engagement)).toBe(false); // and disengaged (no other enemy in sight)
  });

  it('skips a neutral (unowned) issuer, a non-combatant issuer, a self-target, and a dead target', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const neutral = fighterAt(sim, 0, 0, VIKING, WOODCUTTER); // no owner
    const owned = fighterAt(sim, 1, 0, VIKING, WOODCUTTER, { owner: P0 });
    const enemy = fighterAt(sim, 2, 0, VIKING, WOODCUTTER, { owner: P1 });
    // A plain settler with NO Health (a non-combatant) that owns nothing to fight with.
    const civilian = sim.world.create();
    sim.world.add(civilian, Position, { x: fx.fromInt(3), y: fx.fromInt(0) });
    sim.world.add(civilian, Settler, {
      tribe: VIKING,
      jobType: WOODCUTTER,
      hunger: fx.fromInt(0),
      fatigue: fx.fromInt(0),
      piety: fx.fromInt(0),
      enjoyment: fx.fromInt(0),
      experience: new Map(),
    });
    sim.world.add(civilian, Owner, { player: P0 });

    attackUnit(sim.world, ctxOf(sim), { kind: 'attackUnit', entity: neutral, target: enemy });
    attackUnit(sim.world, ctxOf(sim), { kind: 'attackUnit', entity: civilian, target: enemy });
    attackUnit(sim.world, ctxOf(sim), { kind: 'attackUnit', entity: owned, target: owned }); // self
    attackUnit(sim.world, ctxOf(sim), { kind: 'attackUnit', entity: owned, target: 999 as Entity }); // dead id

    expect(sim.world.has(neutral, AttackOrder)).toBe(false);
    expect(sim.world.has(civilian, AttackOrder)).toBe(false);
    expect(sim.world.has(owned, AttackOrder)).toBe(false);
  });

  it('gives up (disengages, drops the order) when the target cannot be approached into range', () => {
    // A 3×3-cell map hand-authored at HALF-CELL resolution whose ONLY walkable node is (3, 2) — the
    // anchor node of cell (1,1); every other node is water. (A cell-resolution map cannot express this:
    // upsampling stamps a walkable 2×2 block, which always leaves an adjacent approach node.) An attacker
    // stacked on its ordered target (distance 0, below melee minRange 1) can never step into the weapon
    // band — approachCell finds no walkable band node. The chase must give up, not loop engaged-forever.
    const boxedWidth = 6;
    const boxedTypeIds = new Array<number>(6 * boxedWidth).fill(1); // water everywhere...
    boxedTypeIds[2 * boxedWidth + 3] = 0; // ...except grass on node (3, 2)
    const boxed: TerrainMap = {
      resolution: 'half-cell',
      width: boxedWidth,
      height: 6,
      typeIds: boxedTypeIds,
    };
    const sim = new Simulation({ seed: 1, content: testContent(), map: boxed });
    const a = fighterAt(sim, 1, 1, VIKING, WOODCUTTER, { owner: P0 });
    const enemy = fighterAt(sim, 1, 1, VIKING, WOODCUTTER, { owner: P1 }); // same node (3, 2) — dist 0

    attackUnit(sim.world, ctxOf(sim), { kind: 'attackUnit', entity: a, target: enemy });
    expect(sim.world.has(a, AttackOrder)).toBe(true); // the order was accepted

    combatSystem(sim.world, ctxOf(sim));

    // Unreachable target → disengaged, order dropped, no lingering chase (no frozen engaged unit).
    expect(sim.world.has(a, AttackOrder)).toBe(false);
    expect(sim.world.has(a, Engagement)).toBe(false);
    expect(sim.world.has(a, MoveGoal)).toBe(false);
    expect(sim.world.has(a, CurrentAtomic)).toBe(false);
  });

  it('is a no-op on a mapless sim (no cells to fight over)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() }); // no map
    const a = fighterAt(sim, 0, 0, VIKING, WOODCUTTER, { owner: P0 });
    const enemy = fighterAt(sim, 1, 0, VIKING, WOODCUTTER, { owner: P1 });

    attackUnit(sim.world, ctxOf(sim), { kind: 'attackUnit', entity: a, target: enemy });

    expect(sim.world.has(a, AttackOrder)).toBe(false);
  });
});

describe('engagement gates the economy (the PlayerOrder-skip pattern)', () => {
  /** A harvestable wood node (a separate entity) at (x,y). */
  function woodAt(sim: Simulation, x: number, y: number): void {
    const e = sim.world.create();
    sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
    sim.world.add(e, Resource, { goodType: WOOD, remaining: 5, harvestAtomic: HARVEST_ATOMIC });
  }

  it('an ENGAGED combatant skips economy planning (does not harvest a resource it stands on)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const cutter = fighterAt(sim, 3, 0, VIKING, WOODCUTTER, { owner: P0 });
    woodAt(sim, 3, 0); // a wood node on the cutter's tile — it would normally start chopping
    sim.world.add(cutter, Engagement, { repathAt: sim.tick });

    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(cutter, CurrentAtomic)).toBe(false); // engaged — the economy did NOT start a harvest
  });

  it('the SAME woodcutter harvests when NOT engaged (proving the gate is what stopped it)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const cutter = fighterAt(sim, 3, 0, VIKING, WOODCUTTER, { owner: P0 });
    woodAt(sim, 3, 0);

    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(cutter, CurrentAtomic).atomicId).toBe(HARVEST_ATOMIC); // economy ran — it harvested
  });
});

describe('a player order is authoritative — it overrides the autonomous drives (economy AND auto-combat)', () => {
  it('moveUnit drops a soldier’s Engagement/AttackOrder so the order supersedes the fight', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(10, 1) });
    const a = fighterAt(sim, 0, 0, VIKING, WOODCUTTER, { owner: P0 });
    fighterAt(sim, 3, 0, VIKING, WOODCUTTER, { owner: P1 }); // beyond reach, inside sight → a engages (chases)

    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(a, Engagement)).toBe(true); // it is fighting (advancing on the enemy)

    // The player orders it to walk AWAY (the far cell's anchor node — command coords are half-cell
    // nodes) — the order clears the combat state and stamps the move + hold.
    const away = cellAnchorNode(9, 0);
    moveUnit(sim.world, ctxOf(sim), { kind: 'moveUnit', entity: a, x: away.hx, y: away.hy });
    expect(sim.world.has(a, Engagement)).toBe(false); // the fight is dropped
    expect(sim.world.has(a, AttackOrder)).toBe(false);
    expect(sim.world.has(a, PlayerOrder)).toBe(true); // now under the move order
    expect(sim.world.get(a, MoveGoal).cell).toBe(sim.terrain?.nodeAtClamped(away.hx, away.hy));
  });

  it('the CombatSystem does not re-engage a unit under a move order, even with an enemy IN REACH', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(10, 1) });
    const a = fighterAt(sim, 1, 0, VIKING, WOODCUTTER, { owner: P0 });
    fighterAt(sim, 2, 0, VIKING, WOODCUTTER, { owner: P1 }); // adjacent — would auto-attack without the order

    const away = cellAnchorNode(9, 0); // command coords are half-cell nodes
    moveUnit(sim.world, ctxOf(sim), { kind: 'moveUnit', entity: a, x: away.hx, y: away.hy });
    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(a, CurrentAtomic)).toBe(false); // no swing — the order wins over the adjacent enemy
    expect(sim.world.has(a, Engagement)).toBe(false); // and it is not dragged back into engagement
    expect(sim.world.has(a, PlayerOrder)).toBe(true); // still carrying the order out
    expect(sim.world.has(a, MoveGoal)).toBe(true);
  });

  it('an explicit attackUnit order still engages — the OPPOSITE intent is honoured, not suppressed', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(10, 1) });
    const a = fighterAt(sim, 1, 0, VIKING, WOODCUTTER, { owner: P0 });
    const target = fighterAt(sim, 2, 0, VIKING, WOODCUTTER, { owner: P1 });

    attackUnit(sim.world, ctxOf(sim), { kind: 'attackUnit', entity: a, target });
    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(a, PlayerOrder)).toBe(false); // attackUnit clears a move order — the two are exclusive
    expect(sim.world.get(a, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target });
  });

  it('full step run: an ordered soldier walks toward its goal and never swings at the enemy it left', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(12, 1) });
    const a = fighterAt(sim, 6, 0, VIKING, WOODCUTTER, { owner: P0 });
    const enemy = fighterAt(sim, 7, 0, VIKING, WOODCUTTER, { owner: P1 }); // adjacent to the right
    const enemyHp0 = sim.world.get(enemy, Health).hitpoints;

    sim.enqueue({ kind: 'moveUnit', entity: a, x: 0, y: 0 }); // ordered LEFT, away from the enemy
    for (let i = 0; i < 40; i++) sim.step();

    // It obeyed: advanced toward x=0 (away from the enemy at x=7) and never damaged the enemy.
    expect(fx.toInt(sim.world.get(a, Position).x)).toBeLessThan(6);
    expect(sim.world.get(enemy, Health).hitpoints).toBe(enemyHp0); // `a` never swung at it
  });
});
