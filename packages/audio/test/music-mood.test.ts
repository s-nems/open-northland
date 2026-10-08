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
 * The music's mood: a blow on the local player starts the attack hold, a run of blows latches a
 * battle that turns tense fast and calms slowly, and the head-count moves a mission in and out of
 * Wealthy. Every latch is hysteretic, so a figure sitting on a line cannot flip the music.
 */

const THEME_VIKING = 2;
const ATTACK_BYZANZ = 8;
const MISSION_ARABS1 = 17;
/** Authors only a Standard segment, so all three of its mood slots name it. */
const MISSION_MIDGARD1 = 20;

const US = 1;
const THEM = 2;
const START_TICK = 100;
const entity = (id: number): Entity => id as Entity;

/** Two combatants, one ours and one theirs, at whatever tick the case needs. */
function snapshotAt(tick: number): WorldSnapshot {
  return {
    tick,
    entities: [
      { id: 10, components: { Owner: { player: US } } },
      { id: 20, components: { Owner: { player: THEM } } },
    ],
    events: [],
  };
}

const hitOn = (target: number): SimEvent => ({
  kind: 'combatHit',
  damage: 250,
  targetMaxHealth: 1000,
  attacker: entity(99),
  target: entity(target),
  at: { hx: 0, hy: 0 },
});

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
  it('holds tense for the attack hold after a lone blow, then calms', () => {
    const mood = moodAfter(CALM_MOOD, [hitOn(10)]);
    expect(mood.battle).toBe(false);
    expect(musicIntensity(mood, START_TICK)).toBe('tense');
    expect(musicIntensity(mood, START_TICK + ATTACK_HOLD_TICKS - 1)).toBe('tense');
    expect(musicIntensity(mood, START_TICK + ATTACK_HOLD_TICKS)).toBe('calm');
  });

  it('restarts the attack hold on every new blow', () => {
    const first = moodAfter(CALM_MOOD, [hitOn(10)]);
    const later = START_TICK + ATTACK_HOLD_TICKS - 1;
    const second = moodAfter(first, [hitOn(10)], 0, later);
    expect(second.attackUntilTick).toBe(later + ATTACK_HOLD_TICKS);
  });

  it('latches a battle on a run of blows and keeps a big one tense well past the attack hold', () => {
    const BIG_FIGHT_BLOWS = 20;
    const blows = Array.from({ length: BIG_FIGHT_BLOWS }, () => hitOn(10));
    const battle = moodAfter(CALM_MOOD, blows);
    expect(battle.battle).toBe(true);
    // One half-life after the hold ran out the threat is still above the exit line.
    const after = moodAfter(battle, [], 0, START_TICK + ATTACK_HOLD_TICKS + THREAT_HALF_LIFE_TICKS);
    expect(after.battle).toBe(true);
    expect(musicIntensity(after, START_TICK + ATTACK_HOLD_TICKS + THREAT_HALF_LIFE_TICKS)).toBe('tense');
  });

  it('calms a battle only once its threat decays below the exit line', () => {
    const blows = Array.from({ length: TENSE_ENTER_THREAT }, () => hitOn(10));
    const battle = moodAfter(CALM_MOOD, blows);
    const halvings = Math.ceil(Math.log2(TENSE_ENTER_THREAT / TENSE_EXIT_THREAT));
    const justAbove = moodAfter(battle, [], 0, START_TICK + (halvings - 1) * THREAT_HALF_LIFE_TICKS);
    expect(justAbove.battle).toBe(true);
    const calmTick = START_TICK + halvings * THREAT_HALF_LIFE_TICKS;
    const calmed = moodAfter(justAbove, [], 0, calmTick);
    expect(calmed.battle).toBe(false);
    expect(musicIntensity(calmed, calmTick)).toBe('calm');
  });

  it('does not re-enter a battle on a blow while the threat sits between the two lines', () => {
    const below = { ...CALM_MOOD, threat: TENSE_EXIT_THREAT, threatTick: START_TICK };
    const nudged = moodAfter(below, [hitOn(10)]);
    expect(nudged.threat).toBeLessThan(TENSE_ENTER_THREAT);
    expect(nudged.battle).toBe(false);
  });

  it('ignores a blow we land on someone else, and their alarm', () => {
    expect(moodAfter(CALM_MOOD, [hitOn(20)]).attackUntilTick).toBe(0);
    const theirAlarm: SimEvent = { kind: 'defenceAlarmRaised', entity: entity(20), player: THEM };
    expect(moodAfter(CALM_MOOD, [theirAlarm]).attackUntilTick).toBe(0);
    const ourAlarm: SimEvent = { kind: 'defenceAlarmRaised', entity: entity(10), player: US };
    expect(moodAfter(CALM_MOOD, [ourAlarm]).attackUntilTick).toBe(START_TICK + ATTACK_HOLD_TICKS);
  });

  it('reads no event as aimed at us when the frame names no local player', () => {
    const mood = nextMusicMood(CALM_MOOD, {
      events: [hitOn(10)],
      snapshot: snapshotAt(START_TICK),
      standing: { population: 0, stance: 'neutral' },
    });
    expect(mood.attackUntilTick).toBe(0);
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
