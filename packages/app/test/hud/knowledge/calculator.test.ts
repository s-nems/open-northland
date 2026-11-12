import { components, type Entity, fx, type Simulation, systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { grassTerrain } from '../../../src/catalog/buildings.js';
import { JOB_SOLDIER_SWORD } from '../../../src/catalog/jobs.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../../../src/game/rules.js';
import { spawnSettlerDirect } from '../../../src/game/sandbox/index.js';
import { createKnowledgeBase } from '../../../src/hud/knowledge/base.js';
import {
  blowResult,
  breakdown,
  type CalculatorState,
  type DuelFighter,
  duelResult,
  initialCalculator,
  ranking,
  resolveTarget,
  weaponGroups,
  withHomeTribe,
  withWeapon,
} from '../../../src/hud/knowledge/calculator.js';
import {
  ANIMAL_TARGET,
  type BlowModifiers,
  CAP_HITS,
  combatTargets,
  DEFENSE_TAKEN_PCT,
  HIT_DIRECTION,
  HUMAN_HITPOINTS,
  landed,
} from '../../../src/hud/knowledge/combat.js';
import type { KnowledgeWeapon } from '../../../src/hud/knowledge/model.js';
import { createSceneSim } from '../../../src/scenes/runtime.js';
import { goodBySlug } from '../../../src/scenes/sandbox-queries.js';
import {
  FRANK,
  FRANK_SMITHY_HITPOINTS,
  HOUSE,
  knowledgeContent,
  SMITHY_HITPOINTS,
  VIKING,
} from '../../support/knowledge-content.js';

const SPEAR_TYPE = 2;
const BOW_TYPE = 6;
const CATAPULT_TYPE = 7;
const CLIP_TICKS = 24;
const MAP_CELLS = 16;

const content = knowledgeContent();
const base = createKnowledgeBase(content);
const targets = combatTargets(base);

const row = (over: Partial<KnowledgeWeapon> = {}): KnowledgeWeapon => ({
  typeId: 1,
  id: 'iron_spear',
  jobType: 33,
  filmJob: null,
  jobName: null,
  goodType: 40,
  goodName: null,
  mainType: SPEAR_TYPE,
  weight: 0,
  minRange: 1,
  maxRange: 1,
  damage: { '0': 1000, '2': 800, '3': 4, '6': 40, '7': 30 },
  clipTicks: CLIP_TICKS,
  blows: 1,
  usable: true,
  ...over,
});

/** A base whose viking arsenal is exactly `rows`. */
const armedBase = (rows: readonly KnowledgeWeapon[]) => ({
  ...base,
  weapons: new Map([[VIKING, rows]]),
});

const fighter = (over: Partial<DuelFighter>): DuelFighter => ({
  tribe: VIKING,
  weapon: 'iron_spear',
  hits: 0,
  strength: false,
  armour: 'bare',
  defense: false,
  ...over,
});

describe('breakdown', () => {
  const modifiers: readonly BlowModifiers[] = [
    { direction: HIT_DIRECTION.front, hits: 0, strength: false, defense: false, targetHits: 0 },
    { direction: HIT_DIRECTION.behind, hits: 60, strength: true, defense: true, targetHits: 100 },
    { direction: HIT_DIRECTION.backSide, hits: 100, strength: true, defense: false, targetHits: 30 },
  ];
  const weapons = [
    row(),
    row({ id: 'hero_spear' }),
    row({ id: 'long_bow', mainType: BOW_TYPE }),
    row({ id: 'catapult', mainType: CATAPULT_TYPE }),
    row({ damage: { '2': 3 } }),
  ];

  it('sums to what landed() answers for every weapon, target and modifier mix', () => {
    for (const weapon of weapons) {
      for (const target of [...targets, ANIMAL_TARGET]) {
        for (const blow of modifiers) {
          const rows = breakdown(weapon, target, blow);
          expect(rows.reduce((sum, r) => sum + r.change, 0)).toBe(landed(weapon, target, blow));
        }
      }
    }
  });

  it('shows the zero floor only for a blow the armour swallows', () => {
    const leather = targets.find((t) => t.id === 'leather');
    if (leather === undefined) throw new Error('no leather');
    const rows = breakdown(row({ damage: { '2': 3 } }), leather, modifiers[0] as BlowModifiers);
    expect(rows.at(-1)?.id).toBe('floor');
    expect(rows.at(-1)?.value).toBe(0);
    expect(breakdown(row(), leather, modifiers[0] as BlowModifiers).some((r) => r.id === 'floor')).toBe(
      false,
    );
  });

  it('says why a rule is left out', () => {
    const skip = (weapon: KnowledgeWeapon, targetId: string, id: string): string | null | undefined => {
      const target = targets.find((t) => t.id === targetId);
      if (target === undefined) throw new Error(targetId);
      return breakdown(weapon, target, { ...(modifiers[0] as BlowModifiers), strength: true }).find(
        (r) => r.id === id,
      )?.skip;
    };
    expect(skip(row({ id: 'hero_spear' }), 'bare', 'experience')).toBe('hero');
    expect(skip(row({ id: 'long_bow', mainType: BOW_TYPE }), 'bare', 'experience')).toBe('ranged');
    expect(skip(row(), 'vehicle', 'experience')).toBe('vehicle');
    expect(skip(row(), 'vehicle', 'direction')).toBe('notPerson');
    expect(skip(row({ id: 'catapult', mainType: CATAPULT_TYPE }), 'building', 'strength')).toBe('catapult');
    expect(skip(row({ id: 'house_bow', mainType: BOW_TYPE }), 'bare', 'strength')).toBe('catapult');
    expect(skip(row(), 'bare', 'targetExperience')).toBe('unseasoned');
    expect(skip(row(), 'building', 'targetExperience')).toBe('notPerson');
  });

  it("cuts a blow by the target's experience, multiplied with his Amulet of Defence", () => {
    const bare = targets.find((t) => t.id === 'bare');
    if (bare === undefined) throw new Error('no bare target');
    const blow = { ...(modifiers[0] as BlowModifiers), targetHits: CAP_HITS };
    const plain = landed(row(), bare);
    const full = systems.fightUnitsOfPoints(CAP_HITS);
    expect(landed(row(), bare, blow)).toBe(systems.withTakenBonuses(plain, full));
    expect(landed(row(), bare, { ...blow, defense: true })).toBe(
      systems.withTakenBonuses(plain, full, DEFENSE_TAKEN_PCT),
    );
  });
});

describe('resolveTarget', () => {
  const start = initialCalculator(base, VIKING).target;

  it("reads a house's durability for the tribe that owns it", () => {
    const house = base.buildingByType.get(HOUSE.smithy)?.id ?? '';
    const of = (buildingTribe: number) =>
      resolveTarget(base, { ...start, kind: 'building', building: house, buildingTribe })?.fullHealth;
    expect(of(VIKING)).toBe(SMITHY_HITPOINTS);
    expect(of(FRANK)).toBe(FRANK_SMITHY_HITPOINTS);
  });

  it('keeps edited health inside the pool, null meaning full', () => {
    const health = (value: number | null) => resolveTarget(base, { ...start, health: value })?.health;
    expect(health(null)).toBe(HUMAN_HITPOINTS);
    expect(health(1200)).toBe(1200);
    expect(health(HUMAN_HITPOINTS * 2)).toBe(HUMAN_HITPOINTS);
    expect(health(-3)).toBe(1);
  });
});

describe('blowResult', () => {
  const armed = armedBase([row({ blows: 2 })]);
  const state = (over: Partial<CalculatorState['target']>): CalculatorState => {
    const start = initialCalculator(armed, VIKING);
    return { ...start, target: { ...start.target, armour: 'bare', ...over } };
  };

  it('counts whole clips for the time and every blow of a clip for the rate', () => {
    const result = blowResult(armed, state({}));
    const damage = 1000;
    expect(result?.damage).toBe(damage);
    expect(result?.hits).toBe(HUMAN_HITPOINTS / damage);
    // 5 blows at 2 a clip finish in the third clip.
    expect(result?.seconds).toBeCloseTo(3 * CLIP_TICKS * (1 / 12), 5);
    expect(result?.perSecond).toBeCloseTo((damage * 2) / (CLIP_TICKS / 12), 5);
  });

  it('scales the blows to kill with the health left', () => {
    expect(blowResult(armed, state({ health: 2500 }))?.hits).toBe(3);
  });
});

describe('ranking', () => {
  it('sorts by time to kill, the blow that cannot kill last at no bar', () => {
    const fast = row({ id: 'iron_spear' });
    const slow = row({ id: 'wooden_spear', clipTicks: CLIP_TICKS * 2 });
    const useless = row({ id: 'long_sword', damage: {} });
    const armed = armedBase([useless, slow, fast]);
    const start = initialCalculator(armed, VIKING);
    const rows = ranking(armed, { ...start, target: { ...start.target, armour: 'bare' } });
    expect(rows.map((r) => r.weapon.id)).toEqual(['iron_spear', 'wooden_spear', 'long_sword']);
    expect(rows.map((r) => r.share)).toEqual([1, 0.5, 0]);
  });

  it('puts a row with no clip after the blow that cannot kill, with no time and no bar', () => {
    const shelter = row({ id: 'long_bow', clipTicks: null });
    const armed = armedBase([shelter, row({ id: 'long_sword', damage: {} }), row()]);
    const start = initialCalculator(armed, VIKING);
    const rows = ranking(armed, { ...start, target: { ...start.target, armour: 'bare' } });
    expect(rows.map((r) => r.weapon.id)).toEqual(['iron_spear', 'long_sword', 'long_bow']);
    expect(rows.at(-1)).toMatchObject({ seconds: null, perSecond: null, share: 0 });
    expect(rows.at(-1)?.hits).not.toBeNull();
  });
});

describe('weapon lists', () => {
  it('holds the heroes back until asked', () => {
    const armed = armedBase([row(), row({ id: 'hero_spear' })]);
    const ids = (heroes: boolean) => weaponGroups(armed, VIKING, heroes).map((g) => g.id);
    expect(ids(false)).toEqual(['soldier']);
    expect(ids(true)).toEqual(['soldier', 'hero']);
  });

  it('opens the heroes for a preselected hero weapon', () => {
    const state = withWeapon({ ...initialCalculator(base, VIKING), mode: 'duel' }, 'hero_spear');
    expect(state).toMatchObject({ mode: 'blow', heroes: true, attacker: { weapon: 'hero_spear' } });
  });
});

describe('withHomeTribe', () => {
  it("follows the window's tribe once and leaves a later pick alone", () => {
    const start = initialCalculator(base, VIKING);
    const moved = withHomeTribe(start, FRANK);
    expect(moved.attacker.tribe).toBe(FRANK);
    expect(moved.duel[1].tribe).toBe(FRANK);
    const picked = { ...moved, attacker: { ...moved.attacker, tribe: VIKING } };
    expect(withHomeTribe(picked, FRANK)).toBe(picked);
  });
});

describe('duelResult', () => {
  const armed = armedBase([
    row({ id: 'iron_spear' }),
    row({ id: 'wooden_spear', damage: { '0': 500 } }),
    row({ id: 'long_sword', damage: {} }),
    row({ id: 'short_sword', damage: { '0': 2500 }, clipTicks: CLIP_TICKS * 2, blows: 2 }),
  ]);

  it('gives the win to the faster kill, with the health the loser left it', () => {
    const result = duelResult(armed, [fighter({}), fighter({ weapon: 'wooden_spear' })]);
    // 5 blows against 10: the loser lands 5 clips of 500 before falling.
    expect(result?.verdict).toEqual({
      kind: 'win',
      winner: 0,
      seconds: (5 * CLIP_TICKS) / 12,
      healthLeft: HUMAN_HITPOINTS - 5 * 500,
    });
  });

  it('is a draw when both finish the same tick', () => {
    expect(duelResult(armed, [fighter({}), fighter({})])?.verdict.kind).toBe('draw');
  });

  it('counts only finished clips against the winner', () => {
    const result = duelResult(armed, [fighter({ weapon: 'short_sword' }), fighter({})]);
    // The sword's two-blow clip ends on tick 48, when the spear has finished two blows of 1000.
    expect(result?.verdict).toMatchObject({
      kind: 'win',
      winner: 0,
      healthLeft: HUMAN_HITPOINTS - 2 * 1000,
    });
  });

  it('is a stalemate when neither blow does anything', () => {
    const empty = fighter({ weapon: 'long_sword' });
    expect(duelResult(armed, [empty, empty])?.verdict.kind).toBe('stalemate');
  });

  it('wins at full health against a fighter who cannot hurt', () => {
    const result = duelResult(armed, [fighter({ weapon: 'long_sword' }), fighter({})]);
    expect(result?.verdict).toMatchObject({ kind: 'win', winner: 1, healthLeft: HUMAN_HITPOINTS });
  });

  it("uses each fighter's own amulets against the other's armour", () => {
    const guarded = duelResult(armed, [fighter({}), fighter({ defense: true })]);
    expect(guarded?.sides[0].damage).toBe(600);
    expect(guarded?.sides[1].damage).toBe(1000);
  });
});

describe('the calculator against the sim', () => {
  const FIGHT_HP = 100_000;
  const STRIKER_POINTS = 60;
  const TARGET_POINTS = 30;
  const CHAMPION = { x: 8, y: 6 } as const;
  const RIVAL = { x: 10, y: 6 } as const;
  const RED = 1;
  const RUN_TICKS = 200;
  const { Equipment, Health, MISC_EQUIP_SLOTS, SettlerProgress } = components;

  /** A short-sword soldier carrying `amulets`, at `points` of fight experience that blows will not move. */
  function duelist(
    sim: Simulation,
    at: { readonly x: number; readonly y: number },
    owner: number,
    amulets: readonly string[],
    points: number,
  ): Entity {
    const e = spawnSettlerDirect(sim, JOB_SOLDIER_SWORD, at.x, at.y, owner);
    const misc = Array.from({ length: MISC_EQUIP_SLOTS }, (_, slot) => {
      const slug = amulets[slot];
      return slug === undefined ? null : { goodType: goodBySlug(sim, slug), degreeOfUse: fx.fromInt(0) };
    });
    sim.world.add(e, Equipment, { boots: null, tool: null, weapon: null, armor: null, misc });
    sim.world.add(e, Health, { hitpoints: FIGHT_HP, max: FIGHT_HP });
    sim.world
      .mut(e, SettlerProgress)
      .experience.set(systems.FIGHT_EXPERIENCE_TYPE.PERSONAL, systems.fightUnitsOfPoints(points));
    components.stampMissionBehaviour(sim.world, e, components.MISSION_BEHAVIOUR.NO_JOB_EXPERIENCE);
    return e;
  }

  it('lands the blow the sim lands, with experience on both sides and both amulets', () => {
    let champion: Entity | undefined;
    let rival: Entity | undefined;
    const sim = createSceneSim({
      seed: 3,
      terrain: grassTerrain(MAP_CELLS, MAP_CELLS),
      build: (s) => {
        champion = duelist(s, CHAMPION, HUMAN_PLAYER, ['amulet_strength'], STRIKER_POINTS);
        rival = duelist(s, RIVAL, RED, ['amulet_defense'], TARGET_POINTS);
        s.enqueueSetup({ kind: 'attackUnit', entity: champion, target: rival });
      },
    });
    let dealt: number | undefined;
    for (let i = 0; i < RUN_TICKS && dealt === undefined; i++) {
      sim.step();
      for (const ev of sim.events.current())
        if (ev.kind === 'combatHit' && ev.attacker === champion && ev.target === rival) dealt = ev.damage;
    }
    const knowledge = createKnowledgeBase(sim.content);
    const weapon = knowledge.weapons.get(PRIMARY_TRIBE)?.find((w) => w.jobType === JOB_SOLDIER_SWORD);
    const bare = combatTargets(knowledge).find((t) => t.id === 'bare');
    if (weapon === undefined || bare === undefined) throw new Error('setup: sword row and bare target');
    const calculated = landed(weapon, bare, {
      direction: HIT_DIRECTION.front,
      hits: STRIKER_POINTS,
      strength: true,
      defense: true,
      targetHits: TARGET_POINTS,
    });
    expect(calculated).not.toBe(landed(weapon, bare));
    expect(dealt).toBe(calculated);
  });
});
