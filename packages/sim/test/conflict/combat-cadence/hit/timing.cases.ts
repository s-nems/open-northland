import { parseContentSet, WERESNAKE_TRIBE } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  CurrentAtomic,
  Health,
  Position,
  ResourceFootprint,
  Settler,
  WALK_DIRECTION,
  type WalkDirection,
  WalkFacing,
} from '../../../../src/components/index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import {
  exportSaveGame,
  nodeOfPosition,
  positionOfNode,
  restoreSimulation,
  Simulation,
} from '../../../../src/index.js';
import { attackerWeapon, startAttack } from '../../../../src/systems/conflict/weapons.js';
import {
  atomicSystem,
  combatSystem,
  REGENERATION_HITPOINTS_PER_TICK,
  WEAPON_MAIN_TYPE,
  withFightExperience,
} from '../../../../src/systems/index.js';
import {
  ATOMIC_EVENT_TYPE_ATTACK,
  ATOMIC_EVENT_TYPE_MOVE_FORWARD,
  ATOMIC_EVENT_TYPE_PLAY_SOUND_FX,
} from '../../../../src/systems/readviews/animations.js';
import { lungeForward } from '../../../../src/systems/settlers/atomics/effects/combat/index.js';
import { fixtureTick, nextTickCtxOf } from '../../../fixtures/context.js';
import {
  ADULT_ANIMAL_JOB,
  ATTACK_ATOMIC,
  combatCadenceContent,
  ctxOf,
  FIST_WEAPON_TYPE,
  fighterAt,
  fighterAtNode,
  grass,
  IRON_SPEAR_DAMAGE,
  OTHER,
  QUIET_FORM_JOB,
  SABER_MAIN_TYPE,
  SOLDIER_SABER,
  SOLDIER_SPEAR,
  SOLDIER_UNARMED,
  startSwing,
  VIKING,
  WOLF_TRIBE,
} from '../support.js';

/** The sound-bank group the synthetic clips cue. */
const CUED_SOUND = 77;

describe('combatSystem - the swing carries the ATTACK-event hit-frame + the weapon class', () => {
  it('binds a jobless wild animal to its adult clip and carries the lunge heading instead of a facing', () => {
    const base = combatCadenceContent();
    const idleJob = base.jobs[0];
    const weapon = base.weapons[0];
    if (idleJob === undefined || weapon === undefined) throw new Error('missing test content');
    const content = parseContentSet({
      ...base,
      jobs: [...base.jobs, { ...idleJob, typeId: ADULT_ANIMAL_JOB, id: 'adult_animal' }],
      tribes: base.tribes.map((tribe) =>
        tribe.typeId === WOLF_TRIBE
          ? {
              ...tribe,
              atomicBindings: [
                ...tribe.atomicBindings,
                { jobType: ADULT_ANIMAL_JOB, atomicId: ATTACK_ATOMIC, animation: 'animal_test_attack' },
              ],
            }
          : tribe,
      ),
      atomicAnimations: [
        ...base.atomicAnimations,
        {
          id: 'animal_test_attack',
          name: 'animal_test_attack',
          length: 24,
          events: [
            { at: 1, type: ATOMIC_EVENT_TYPE_PLAY_SOUND_FX, value: CUED_SOUND },
            { at: 6, type: ATOMIC_EVENT_TYPE_ATTACK },
            { at: 10, type: ATOMIC_EVENT_TYPE_ATTACK },
            { at: 22, type: ATOMIC_EVENT_TYPE_MOVE_FORWARD },
          ],
        },
      ],
    });
    const sim = new Simulation({ seed: 1, content, map: grass(3, 1) });
    const wolf = fighterAtNode(sim, 0, 0, WOLF_TRIBE, null);
    const target = fighterAtNode(sim, 1, 0, OTHER, null);
    startAttack(
      sim.world,
      ctxOf(sim),
      sim.world.get(wolf, Settler),
      wolf,
      target,
      { damage: 100, hitSoundType: undefined },
      weapon,
    );
    const swing = sim.world.get(wolf, CurrentAtomic);
    expect(swing.duration).toBe(24);
    expect(swing.effect).toEqual({
      kind: 'attack',
      target,
      damage: 100,
      hitFrames: [6, 10],
      lunge: { frames: [22], direction: WALK_DIRECTION.E },
      weaponMainType: WEAPON_MAIN_TYPE.UNARMED,
      maxRange: 1,
    });
    // No walk facing is left behind for a later walk to show stale.
    expect(sim.world.has(wolf, WalkFacing)).toBe(false);
    atomicSystem(sim.world, nextTickCtxOf(sim));
    expect(sim.events.current()).toContainEqual({ kind: 'atomicSound', entity: wolf, soundType: CUED_SOUND });
  });

  it('keeps a natural weapon across form jobs; a person form never lunges, even on an animal clip', () => {
    const base = combatCadenceContent();
    const idleJob = base.jobs[0];
    const soldierWeapon = base.weapons[1];
    if (idleJob === undefined || soldierWeapon === undefined) throw new Error('missing test content');
    const content = parseContentSet({
      ...base,
      jobs: [...base.jobs, { ...idleJob, typeId: QUIET_FORM_JOB, id: 'animal_form' }],
      tribes: base.tribes.map((tribe) =>
        tribe.typeId === VIKING
          ? {
              ...tribe,
              typeId: WERESNAKE_TRIBE,
              id: 'weresnake',
              naturalWeaponType: FIST_WEAPON_TYPE,
              jobEnables: [],
              atomicBindings: [
                ...tribe.atomicBindings,
                { jobType: SOLDIER_SPEAR, atomicId: ATTACK_ATOMIC, animation: 'animal_form_attack' },
                { jobType: QUIET_FORM_JOB, atomicId: ATTACK_ATOMIC, animation: 'quiet_form_attack' },
              ],
            }
          : tribe,
      ),
      weapons: [
        {
          ...soldierWeapon,
          id: 'earlier_form_weapon',
          tribeType: WERESNAKE_TRIBE,
          jobType: QUIET_FORM_JOB,
          damage: { '0': 100 },
        },
        ...base.weapons.map((weapon) =>
          weapon.tribeType === VIKING ? { ...weapon, tribeType: WERESNAKE_TRIBE } : weapon,
        ),
      ],
      atomicAnimations: [
        ...base.atomicAnimations,
        {
          id: 'animal_form_attack',
          name: 'animal_form_attack',
          length: 24,
          events: [
            { at: 6, type: ATOMIC_EVENT_TYPE_ATTACK },
            { at: 22, type: ATOMIC_EVENT_TYPE_MOVE_FORWARD },
          ],
        },
        {
          id: 'quiet_form_attack',
          name: 'quiet_form_attack',
          length: 4,
          events: [{ at: 1, type: ATOMIC_EVENT_TYPE_PLAY_SOUND_FX, value: CUED_SOUND }],
        },
      ],
    });
    const sim = new Simulation({ seed: 1, content, map: grass(3, 1) });
    const form = fighterAtNode(sim, 0, 0, WERESNAKE_TRIBE, SOLDIER_SPEAR);
    const target = fighterAtNode(sim, 1, 0, OTHER, null);
    const armed = attackerWeapon(ctxOf(sim), WERESNAKE_TRIBE, SOLDIER_SPEAR);
    expect(armed?.weapon.id).toBe('fist');
    if (armed === null) throw new Error('missing retained weapon');
    startAttack(
      sim.world,
      ctxOf(sim),
      sim.world.get(form, Settler),
      form,
      target,
      { damage: 100, hitSoundType: undefined },
      armed.weapon,
    );
    expect(sim.world.get(form, CurrentAtomic).effect).toEqual({
      kind: 'attack',
      target,
      damage: 100,
      hitFrames: [6],
      weaponMainType: WEAPON_MAIN_TYPE.UNARMED,
      maxRange: 1,
    });

    const quiet = fighterAtNode(sim, 3, 0, WERESNAKE_TRIBE, QUIET_FORM_JOB);
    const quietTarget = fighterAtNode(sim, 4, 0, OTHER, null, { hitpoints: 1000 });
    const quietArmed = attackerWeapon(ctxOf(sim), WERESNAKE_TRIBE, QUIET_FORM_JOB);
    expect(quietArmed?.weapon.id).toBe('fist');
    if (quietArmed === null) throw new Error('missing retained weapon');
    startAttack(
      sim.world,
      ctxOf(sim),
      sim.world.get(quiet, Settler),
      quiet,
      quietTarget,
      { damage: 100, hitSoundType: undefined },
      quietArmed.weapon,
    );
    expect(sim.world.get(quiet, CurrentAtomic).effect).toMatchObject({ hitFrames: [] });
    for (let i = 0; i < 4; i++) atomicSystem(sim.world, nextTickCtxOf(sim));
    expect(sim.world.get(quietTarget, Health).hitpoints).toBe(1000);
    // Past the animal clip's forward event: the person form has not moved.
    for (let i = 4; i < 22; i++) atomicSystem(sim.world, nextTickCtxOf(sim));
    expect(sim.world.get(form, Position)).toEqual(positionOfNode(0, 0));
  });

  it('lands every authored hit event of a multi-blow clip, and a swing restored between blows lands the rest', () => {
    const blows = [6, 10, 22];
    const clipLength = 32;
    const [firstBlow] = blows;
    if (firstBlow === undefined) throw new Error('missing blow');
    const base = combatCadenceContent();
    const content = parseContentSet({
      ...base,
      atomicAnimations: base.atomicAnimations.map((clip) =>
        clip.name === 'soldier_attack_unarmed'
          ? {
              ...clip,
              length: clipLength,
              events: blows.map((at) => ({ at, type: ATOMIC_EVENT_TYPE_ATTACK })),
            }
          : clip,
      ),
    });
    const sim = new Simulation({ seed: 1, content, map: grass(3, 1) });
    const attacker = fighterAt(sim, 0, 0, VIKING, SOLDIER_UNARMED);
    const target = fighterAtNode(sim, 1, 0, OTHER, null, { hitpoints: 10_000 });
    combatSystem(sim.world, ctxOf(sim));
    const swing = sim.world.get(attacker, CurrentAtomic);
    expect(swing.duration).toBe(clipLength);
    expect(swing.effect).toMatchObject({ hitFrames: blows });

    const hitFrames = (run: Simulation, from: number, to: number): number[] => {
      const landed: number[] = [];
      let priorHp = run.world.get(target, Health).hitpoints;
      for (let frame = from; frame <= to; frame++) {
        atomicSystem(run.world, nextTickCtxOf(run));
        const hp = run.world.get(target, Health).hitpoints;
        if (hp < priorHp) landed.push(frame);
        priorHp = hp;
      }
      return landed;
    };
    expect(hitFrames(sim, 1, firstBlow)).toEqual([firstBlow]);
    const saved = exportSaveGame(sim);
    const restored = restoreSimulation(
      { ...saved, header: { ...saved.header, tick: fixtureTick(sim) } },
      { content, map: grass(3, 1) },
    );
    expect(hitFrames(restored, firstBlow + 1, clipLength)).toEqual(blows.slice(1));
    expect(restored.world.has(attacker, CurrentAtomic)).toBe(false);
  });

  it('stamps attack frames from the animation and weaponMainType from the weapon', () => {
    const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(3, 1) });
    const spearman = fighterAt(sim, 0, 0, VIKING, SOLDIER_SPEAR);
    fighterAt(sim, 1, 0, OTHER, null);
    combatSystem(sim.world, ctxOf(sim));
    // iron spear: ATTACK @17 of the 27-frame swing, weapon class SPEAR.
    expect(sim.world.get(spearman, CurrentAtomic).effect).toMatchObject({
      hitFrames: [17],
      weaponMainType: WEAPON_MAIN_TYPE.SPEAR,
    });
    expect(sim.world.get(spearman, CurrentAtomic).duration).toBe(27);
  });

  it('keeps an empty hit list when a bound attack animation has no attack event', () => {
    const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(3, 1) });
    const saberer = fighterAt(sim, 0, 0, VIKING, SOLDIER_SABER); // saber animation has no `event <f> 25`
    fighterAtNode(sim, 1, 0, OTHER, null); // 1 node away - the saber's whole reach band is [1, 1]
    combatSystem(sim.world, ctxOf(sim));
    const effect = sim.world.get(saberer, CurrentAtomic).effect;
    expect(effect).toMatchObject({ hitFrames: [] }); // no ATTACK event -> the clip lands no blow
    expect(effect).toMatchObject({ weaponMainType: SABER_MAIN_TYPE });
  });
});

describe('atomicSystem - the blow lands at the ATTACK-event frame, not at completion', () => {
  it('drains the target exactly once, at the ATTACK frame mid-animation', () => {
    const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(3, 1) });
    const attacker = fighterAt(sim, 0, 0, VIKING, SOLDIER_SPEAR);
    const target = fighterAt(sim, 1, 0, OTHER, null, { hitpoints: 10_000 });
    startSwing(sim, attacker, { target, damage: 2090, hitFrames: [17] }, 27);

    // Frames 1..16: the swing is winding up - the target is untouched.
    for (let i = 0; i < 16; i++) atomicSystem(sim.world, nextTickCtxOf(sim));
    expect(sim.world.get(target, Health).hitpoints).toBe(10_000);

    // Frame 17: the blow lands.
    atomicSystem(sim.world, nextTickCtxOf(sim));
    expect(sim.world.get(target, Health).hitpoints).toBe(10_000 - 2090);

    // Frames 18..27 (follow-through): no second hit, and the swing completes at 27 (attacker freed).
    for (let i = 0; i < 10; i++) atomicSystem(sim.world, nextTickCtxOf(sim));
    expect(sim.world.get(target, Health).hitpoints).toBe(10_000 - 2090); // still one blow only
    expect(sim.world.has(attacker, CurrentAtomic)).toBe(false); // completed
  });

  it('falls back to the completion frame when the swing carries no hit frames', () => {
    const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(3, 1) });
    const attacker = fighterAt(sim, 0, 0, VIKING, SOLDIER_SABER);
    const target = fighterAt(sim, 1, 0, OTHER, null, { hitpoints: 10_000 });
    startSwing(sim, attacker, { target, damage: 400 }, 4); // no attack event -> resolve at completion

    for (let i = 0; i < 3; i++) atomicSystem(sim.world, nextTickCtxOf(sim));
    expect(sim.world.get(target, Health).hitpoints).toBe(10_000); // untouched until the last frame

    atomicSystem(sim.world, nextTickCtxOf(sim)); // frame 4 = completion
    expect(sim.world.get(target, Health).hitpoints).toBe(10_000 - 400);
    expect(sim.world.has(attacker, CurrentAtomic)).toBe(false);
  });
});

describe('atomicSystem - repeating swings at the animation cadence', () => {
  it('a survivor is re-struck one animation-length apart (cadence IS the swing length)', () => {
    const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(3, 1) });
    fighterAt(sim, 0, 0, VIKING, SOLDIER_SPEAR); // spear: 27-frame swing, ATTACK @17
    const target = fighterAt(sim, 1, 0, OTHER, null, { hitpoints: 1_000_000 });

    const hitTicks: number[] = [];
    // Damage is summed blow by blow rather than read off the end state: a fed settler heals between
    // blows, so the pool climbs back between them.
    let dealt = 0;
    let prevHp = sim.world.get(target, Health).hitpoints;
    for (let tick = 1; tick <= 60; tick++) {
      sim.step();
      const hp = sim.world.get(target, Health).hitpoints;
      if (hp < prevHp) {
        hitTicks.push(tick);
        dealt += prevHp - hp;
      }
      prevHp = hp;
    }

    expect(hitTicks.length).toBeGreaterThanOrEqual(2);
    // Consecutive blows land exactly one swing (27 ticks) apart - the cadence is the animation length,
    // no invented cooldown.
    const firstHit = hitTicks[0];
    const secondHit = hitTicks[1];
    if (firstHit === undefined || secondHit === undefined) throw new Error('expected two hits');
    expect(secondHit - firstHit).toBe(27);
    // Each blow took the spear-vs-unarmored column off the pool, raised by the hits landed before it. The
    // needs pass runs ahead of the blow, so every blow after the first lands on a tick that also heals.
    const column = IRON_SPEAR_DAMAGE['0'];
    const blows = hitTicks.reduce((sum, _, hits) => sum + withFightExperience(column, hits), 0);
    const expected = blows - (hitTicks.length - 1) * REGENERATION_HITPOINTS_PER_TICK;
    expect(dealt).toBe(expected);
  });
});

describe("atomicSystem - an animal attack clip's forward event", () => {
  /** A synthetic unwalkable ground type. */
  const WATER = 1;
  const LUNGE_FRAME = 3;
  const SWING_LENGTH = 4;

  const place = (sim: Simulation, e: Entity, hx: number, hy: number): void => {
    const at = positionOfNode(hx, hy);
    const p = sim.world.mut(e, Position);
    p.x = at.x;
    p.y = at.y;
  };
  const nodeOf = (sim: Simulation, e: Entity): readonly [number, number] => {
    const p = sim.world.get(e, Position);
    const { hx, hy } = nodeOfPosition(p.x, p.y);
    return [hx, hy];
  };

  it('steps at its lunge frame along the heading the swing carries, also after a restore', () => {
    const content = combatCadenceContent();
    const sim = new Simulation({ seed: 1, content, map: grass(3, 1) });
    const wolf = fighterAtNode(sim, 1, 0, WOLF_TRIBE, null);
    const target = fighterAtNode(sim, 3, 0, OTHER, null);
    const lunge = { frames: [LUNGE_FRAME], direction: WALK_DIRECTION.E };
    startSwing(sim, wolf, { target, damage: 0, hitFrames: [], lunge }, SWING_LENGTH);
    for (let frame = 1; frame < LUNGE_FRAME; frame++) atomicSystem(sim.world, nextTickCtxOf(sim));
    expect(nodeOf(sim, wolf)).toEqual([1, 0]);

    const saved = exportSaveGame(sim);
    const restored = restoreSimulation(
      { ...saved, header: { ...saved.header, tick: fixtureTick(sim) } },
      { content, map: grass(3, 1) },
    );
    atomicSystem(restored.world, nextTickCtxOf(restored));
    expect(nodeOf(restored, wolf)).toEqual([2, 0]);
  });

  it('moves one map point per facing: along the row, two rows north or south, diagonals by row parity', () => {
    const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(5, 5) });
    const wolf = fighterAtNode(sim, 0, 0, WOLF_TRIBE, null);
    const { E, SE, SW, W, NW, NE, N, S } = WALK_DIRECTION;
    // [from, facing, to] in half-cell nodes; an odd row counts half a node east of an even one.
    const EVEN: readonly [number, number] = [4, 4];
    const ODD: readonly [number, number] = [4, 5];
    const cases: ReadonlyArray<
      readonly [readonly [number, number], WalkDirection, readonly [number, number]]
    > = [
      [EVEN, E, [5, 4]],
      [EVEN, W, [3, 4]],
      [EVEN, N, [4, 2]],
      [EVEN, S, [4, 6]],
      [EVEN, NE, [4, 3]],
      [EVEN, NW, [3, 3]],
      [EVEN, SE, [4, 5]],
      [EVEN, SW, [3, 5]],
      [ODD, N, [4, 3]],
      [ODD, S, [4, 7]],
      [ODD, NE, [5, 4]],
      [ODD, NW, [4, 4]],
      [ODD, SE, [5, 6]],
      [ODD, SW, [4, 6]],
    ];
    const landed = cases.map(([[hx, hy], facing]) => {
      place(sim, wolf, hx, hy);
      lungeForward(sim.world, ctxOf(sim), wolf, facing);
      return nodeOf(sim, wolf);
    });
    expect(landed).toEqual(cases.map(([, , to]) => to));
  });

  it('stays put before unwalkable ground or a dynamic block, but not before a unit', () => {
    const base = combatCadenceContent();
    const content = parseContentSet({
      ...base,
      landscape: [...base.landscape, { typeId: WATER, id: 'water', walkable: false, buildable: false }],
    });
    const open = grass(4, 3);
    const water = {
      ...open,
      typeIds: open.typeIds.map((type, n) => (n === 2 * open.width + 4 ? WATER : type)),
    };
    const sim = new Simulation({ seed: 1, content, map: water });
    const wolf = fighterAtNode(sim, 3, 2, WOLF_TRIBE, null);
    const tree = sim.world.create();
    sim.world.add(tree, Position, positionOfNode(2, 2));
    sim.world.add(tree, ResourceFootprint, { walk: [{ dx: 0, dy: 0 }], build: [], work: [] });
    fighterAtNode(sim, 3, 1, OTHER, null);

    lungeForward(sim.world, ctxOf(sim), wolf, WALK_DIRECTION.E); // water at (4, 2)
    expect(nodeOf(sim, wolf)).toEqual([3, 2]);
    lungeForward(sim.world, ctxOf(sim), wolf, WALK_DIRECTION.W); // the tree's body at (2, 2)
    expect(nodeOf(sim, wolf)).toEqual([3, 2]);
    lungeForward(sim.world, ctxOf(sim), wolf, WALK_DIRECTION.NE); // a person stands at (3, 1)
    expect(nodeOf(sim, wolf)).toEqual([3, 1]);
  });
});
