import type { Entity, SimEvent, WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import {
  ATTACK_HOLD_TICKS,
  CALM_MOOD,
  MUSIC_VARIANTS,
  type MusicMoodState,
  musicIntensity,
  nextMusicMood,
  ownCalmStem,
  ownTenseStem,
  TENSE_ENTER_THREAT,
  TENSE_EXIT_THREAT,
  THREAT_HALF_LIFE_TICKS,
  WEALTHY_POPULATION,
  WEALTHY_POPULATION_DROP,
} from '../src/index.js';

/**
 * The music's mood: a run of blows between us and another player latches a battle that turns tense
 * fast and calms slowly, the attack hold sustains a battle but never starts one, and the head-count
 * moves a mission in and out of Wealthy. Every latch is hysteretic, so a figure sitting on a line
 * cannot flip the music.
 */

const THEME_VIKING = 2;
const ATTACK_BYZANZ = 8;
const MISSION_ARABS1 = 17;
/** Authors only a Standard segment, so all three of its mood slots name it. */
const MISSION_MIDGARD1 = 20;

const US = 1;
const THEM = 2;
const OUR_SETTLER = 10;
const THEIR_SETTLER = 20;
const DEER = 30;
const START_TICK = 100;
const entity = (id: number): Entity => id as Entity;

/** Two combatants, one ours and one theirs, and an unowned deer, at whatever tick the case needs. */
function snapshotAt(tick: number): WorldSnapshot {
  return {
    tick,
    entities: [
      { id: OUR_SETTLER, components: { Owner: { player: US } } },
      { id: THEIR_SETTLER, components: { Owner: { player: THEM } } },
      { id: DEER, components: {} },
    ],
    events: [],
  };
}

/** A melee blow on `target`, struck by `attackerPlayer`'s side. */
const hitOn = (target: number, attackerPlayer = THEM): SimEvent => ({
  kind: 'combatHit',
  damage: 250,
  targetMaxHealth: 1000,
  attacker: entity(99),
  attackerPlayer,
  target: entity(target),
  at: { hx: 0, hy: 0 },
});

/** A wolf's bite on `target`: a blow from nobody's side. */
const biteOn = (target: number): SimEvent => ({
  kind: 'combatHit',
  attacker: entity(98),
  target: entity(target),
  at: { hx: 0, hy: 0 },
});

const blows = (count: number, blow: () => SimEvent = () => hitOn(OUR_SETTLER)): SimEvent[] =>
  Array.from({ length: count }, blow);

const moodAfter = (
  previous: MusicMoodState,
  events: readonly SimEvent[],
  population = 0,
  tick = START_TICK,
) =>
  nextMusicMood(previous, {
    events,
    snapshot: snapshotAt(tick),
    standing: { population, stance: 'neutral' },
    localPlayer: US,
  });

const variants = (code: number) => {
  const found = MUSIC_VARIANTS[code];
  if (found === undefined) throw new Error(`no variants for ${code}`);
  return found;
};

describe('music intensity', () => {
  it('stays calm on a wolf’s bites, however many', () => {
    const MANY = 10;
    const mood = moodAfter(
      CALM_MOOD,
      blows(MANY, () => biteOn(OUR_SETTLER)),
    );
    expect(mood.battle).toBe(false);
    expect(mood.threat).toBe(0);
    expect(musicIntensity(mood)).toBe('calm');
  });

  it('stays calm on a lone blow from another player, which only starts the attack hold', () => {
    const mood = moodAfter(CALM_MOOD, [hitOn(OUR_SETTLER)]);
    expect(mood.attackUntilTick).toBe(START_TICK + ATTACK_HOLD_TICKS);
    expect(musicIntensity(mood)).toBe('calm');
  });

  it('latches a battle on a run of blows from another player', () => {
    expect(musicIntensity(moodAfter(CALM_MOOD, blows(TENSE_ENTER_THREAT - 1)))).toBe('calm');
    expect(musicIntensity(moodAfter(CALM_MOOD, blows(TENSE_ENTER_THREAT)))).toBe('tense');
  });

  it('counts blows we land on another player, but not a hunter’s shot at game or a stray shot', () => {
    const ours = moodAfter(
      CALM_MOOD,
      blows(TENSE_ENTER_THREAT, () => hitOn(THEIR_SETTLER, US)),
    );
    expect(ours.battle).toBe(true);
    const shot = (target: number, collateral: boolean): SimEvent => ({
      kind: 'projectileHit',
      projectile: entity(98),
      shooter: entity(97),
      shooterPlayer: US,
      ...(collateral ? { collateral: true } : {}),
      target: entity(target),
      munitionType: 1,
      at: { hx: 0, hy: 0 },
    });
    const hunt = moodAfter(
      CALM_MOOD,
      blows(TENSE_ENTER_THREAT, () => shot(DEER, false)),
    );
    expect(hunt.threat).toBe(0);
    const stray = moodAfter(
      CALM_MOOD,
      blows(TENSE_ENTER_THREAT, () => shot(THEIR_SETTLER, true)),
    );
    expect(stray.threat).toBe(0);
  });

  it('sustains a battle through the attack hold after its threat decays', () => {
    const battle = moodAfter(CALM_MOOD, blows(TENSE_ENTER_THREAT));
    // A late blow restarts the hold; long after it the threat sits under the exit line.
    const lateTick = START_TICK + THREAT_HALF_LIFE_TICKS * 4;
    const late = moodAfter(battle, [hitOn(OUR_SETTLER)], 0, lateTick);
    const quietTick = lateTick + ATTACK_HOLD_TICKS - 1;
    const held = moodAfter(late, [], 0, quietTick);
    expect(held.threat).toBeLessThan(TENSE_EXIT_THREAT);
    expect(musicIntensity(held)).toBe('tense');
    expect(musicIntensity(moodAfter(held, [], 0, lateTick + ATTACK_HOLD_TICKS))).toBe('calm');
  });

  it('keeps a big battle tense well past the attack hold', () => {
    const BIG_FIGHT_BLOWS = 20;
    const battle = moodAfter(CALM_MOOD, blows(BIG_FIGHT_BLOWS));
    // One half-life after the hold ran out the threat is still above the exit line.
    const after = moodAfter(battle, [], 0, START_TICK + ATTACK_HOLD_TICKS + THREAT_HALF_LIFE_TICKS);
    expect(musicIntensity(after)).toBe('tense');
  });

  it('calms a battle once its threat decays below the exit line and the hold has run out', () => {
    const battle = moodAfter(CALM_MOOD, blows(TENSE_ENTER_THREAT));
    const halvings = Math.ceil(Math.log2(TENSE_ENTER_THREAT / TENSE_EXIT_THREAT));
    const justAbove = moodAfter(battle, [], 0, START_TICK + (halvings - 1) * THREAT_HALF_LIFE_TICKS);
    expect(justAbove.battle).toBe(true);
    const calmed = moodAfter(justAbove, [], 0, START_TICK + halvings * THREAT_HALF_LIFE_TICKS);
    expect(musicIntensity(calmed)).toBe('calm');
  });

  it('does not re-enter a battle on a blow while the threat sits between the two lines', () => {
    const below = { ...CALM_MOOD, threat: TENSE_EXIT_THREAT, threatTick: START_TICK };
    const nudged = moodAfter(below, [hitOn(OUR_SETTLER)]);
    expect(nudged.threat).toBeLessThan(TENSE_ENTER_THREAT);
    expect(nudged.battle).toBe(false);
  });

  it('ignores a fight between two other players and a raised alarm', () => {
    const THIRD = 3;
    expect(
      moodAfter(
        CALM_MOOD,
        blows(TENSE_ENTER_THREAT, () => hitOn(THEIR_SETTLER, THIRD)),
      ).threat,
    ).toBe(0);
    const ourAlarm: SimEvent = { kind: 'defenceAlarmRaised', entity: entity(OUR_SETTLER), player: US };
    expect(moodAfter(CALM_MOOD, [ourAlarm]).attackUntilTick).toBe(0);
  });

  it('reads no event as aimed at us when the frame names no local player', () => {
    const mood = nextMusicMood(CALM_MOOD, {
      events: blows(TENSE_ENTER_THREAT),
      snapshot: snapshotAt(START_TICK),
      standing: { population: 0, stance: 'neutral' },
    });
    expect(mood.attackUntilTick).toBe(0);
    expect(mood.battle).toBe(false);
  });
});

describe('wealth', () => {
  it('promotes a mission to Wealthy at the settled head-count', () => {
    expect(moodAfter(CALM_MOOD, [], WEALTHY_POPULATION - 1).wealthy).toBe(false);
    expect(moodAfter(CALM_MOOD, [], WEALTHY_POPULATION).wealthy).toBe(true);
  });

  it('holds Wealthy through a dip, and drops it only well below the promotion line', () => {
    const wealthy = moodAfter(CALM_MOOD, [], WEALTHY_POPULATION);
    expect(moodAfter(wealthy, [], WEALTHY_POPULATION - 1).wealthy).toBe(true);
    expect(moodAfter(wealthy, [], WEALTHY_POPULATION_DROP).wealthy).toBe(false);
  });
});

describe('own stems', () => {
  it('picks a theme’s calm stem by the standing', () => {
    expect(ownCalmStem(variants(THEME_VIKING), 'friend', false)).toBe('theme_viking_friendly');
    expect(ownCalmStem(variants(THEME_VIKING), 'neutral', false)).toBe('theme_viking_neutral');
    expect(ownCalmStem(variants(THEME_VIKING), 'enemy', false)).toBe('theme_viking_hostile');
    expect(ownTenseStem(variants(THEME_VIKING))).toBe('theme_viking_hostile');
  });

  it('picks a mission’s calm stem by its wealth and fights to its Danger stem', () => {
    expect(ownCalmStem(variants(MISSION_ARABS1), 'neutral', false)).toBe('mission_arabs1_standard');
    expect(ownCalmStem(variants(MISSION_ARABS1), 'neutral', true)).toBe('mission_arabs1_wealthy');
    expect(ownTenseStem(variants(MISSION_ARABS1))).toBe('mission_arabs1_danger');
  });

  it('gives a mission with no Danger segment no tense stem of its own', () => {
    expect(ownCalmStem(variants(MISSION_MIDGARD1), 'neutral', true)).toBe('mission_midgard1_standard');
    expect(ownTenseStem(variants(MISSION_MIDGARD1))).toBeNull();
  });

  it('plays an Attack map’s one segment in either mood', () => {
    expect(ownCalmStem(variants(ATTACK_BYZANZ), 'enemy', true)).toBe('attack_byzanz');
    expect(ownTenseStem(variants(ATTACK_BYZANZ))).toBe('attack_byzanz');
  });
});
