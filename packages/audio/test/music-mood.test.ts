import type { DiplomacyState, Entity, SimEvent, WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import {
  CALM_MOOD,
  CONFLICT_HOLD_TICKS,
  type MusicMoodState,
  musicTrackFor,
  nextMusicMood,
  parseMusicManifest,
  WEALTHY_POPULATION,
  WEALTHY_POPULATION_DROP,
} from '../src/index.js';

/**
 * Which mood variant a map's music picks: themes switch on the local player's standing, missions on
 * its head-count, and a blow landing on the local player latches both to their tense variant for
 * {@link CONFLICT_HOLD_TICKS}. Both latches are hysteretic, so a figure sitting on a threshold cannot
 * crossfade the track back and forth.
 */

const THEME_VIKING = 2;
const ATTACK_BYZANZ = 8;
const MISSION_ARABS1 = 17;
/** Authors only a Standard segment, so all three of its mood slots name it. */
const MISSION_MIDGARD1 = 20;

const MANIFEST = parseMusicManifest({
  tracks: Object.fromEntries(
    [
      'theme_viking_friendly',
      'theme_viking_neutral',
      'theme_viking_hostile',
      'attack_byzanz',
      'mission_arabs1_standard',
      'mission_arabs1_wealthy',
      'mission_arabs1_danger',
      'mission_midgard1_standard',
    ].map((stem) => [stem, { file: `${stem}.ogg` }]),
  ),
});

const US = 1;
const THEM = 2;
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
  attacker: entity(99),
  target: entity(target),
  at: { hx: 0, hy: 0 },
});

const moodAfter = (previous: MusicMoodState, events: readonly SimEvent[], population = 0, tick = 100) =>
  nextMusicMood(previous, {
    events,
    snapshot: snapshotAt(tick),
    standing: { population, stance: 'neutral' },
    localPlayer: US,
  });

const fileFor = (musicType: number, mood = CALM_MOOD, tick = 0, stance: DiplomacyState = 'neutral') =>
  musicTrackFor(musicType, stance, mood, tick, MANIFEST)?.file;

describe('music mood', () => {
  it('picks a theme variant by the standing the map is in', () => {
    expect(fileFor(THEME_VIKING, CALM_MOOD, 0, 'friend')).toBe('theme_viking_friendly.ogg');
    expect(fileFor(THEME_VIKING, CALM_MOOD, 0, 'neutral')).toBe('theme_viking_neutral.ogg');
    expect(fileFor(THEME_VIKING, CALM_MOOD, 0, 'enemy')).toBe('theme_viking_hostile.ogg');
  });

  it('promotes a mission to Wealthy at the settled head-count', () => {
    const under = moodAfter(CALM_MOOD, [], WEALTHY_POPULATION - 1);
    const over = moodAfter(CALM_MOOD, [], WEALTHY_POPULATION);
    expect(fileFor(MISSION_ARABS1, under)).toBe('mission_arabs1_standard.ogg');
    expect(fileFor(MISSION_ARABS1, over)).toBe('mission_arabs1_wealthy.ogg');
  });

  it('holds Wealthy through a dip, and drops it only well below the promotion line', () => {
    const wealthy = moodAfter(CALM_MOOD, [], WEALTHY_POPULATION);
    const dipped = moodAfter(wealthy, [], WEALTHY_POPULATION - 1);
    expect(fileFor(MISSION_ARABS1, dipped)).toBe('mission_arabs1_wealthy.ogg');
    const collapsed = moodAfter(wealthy, [], WEALTHY_POPULATION_DROP);
    expect(fileFor(MISSION_ARABS1, collapsed)).toBe('mission_arabs1_standard.ogg');
  });

  it('keeps a mission with no other segment on Standard in every mood', () => {
    const wealthyAndTense = { conflictUntilTick: 5, wealthy: true };
    expect(fileFor(MISSION_MIDGARD1, wealthyAndTense, 0)).toBe('mission_midgard1_standard.ogg');
  });

  it('plays an Attack map through, having no mood variants to switch', () => {
    expect(fileFor(ATTACK_BYZANZ, { conflictUntilTick: 5, wealthy: true }, 0, 'enemy')).toBe(
      'attack_byzanz.ogg',
    );
  });

  it('latches the tense variant on a blow against us and releases it after the hold', () => {
    const mood = moodAfter(CALM_MOOD, [hitOn(10)], WEALTHY_POPULATION);
    expect(mood.conflictUntilTick).toBe(100 + CONFLICT_HOLD_TICKS);
    expect(fileFor(MISSION_ARABS1, mood, 100)).toBe('mission_arabs1_danger.ogg');
    expect(fileFor(THEME_VIKING, mood, 100, 'friend')).toBe('theme_viking_hostile.ogg');
    // One tick past the hold the standing decides again.
    expect(fileFor(MISSION_ARABS1, mood, 100 + CONFLICT_HOLD_TICKS)).toBe('mission_arabs1_wealthy.ogg');
    expect(fileFor(THEME_VIKING, mood, 100 + CONFLICT_HOLD_TICKS, 'friend')).toBe(
      'theme_viking_friendly.ogg',
    );
  });

  it('ignores a blow we land on someone else, and their alarm', () => {
    expect(moodAfter(CALM_MOOD, [hitOn(20)]).conflictUntilTick).toBe(0);
    const theirAlarm: SimEvent = { kind: 'defenceAlarmRaised', entity: entity(20), player: THEM };
    expect(moodAfter(CALM_MOOD, [theirAlarm]).conflictUntilTick).toBe(0);
    const ourAlarm: SimEvent = { kind: 'defenceAlarmRaised', entity: entity(10), player: US };
    expect(moodAfter(CALM_MOOD, [ourAlarm]).conflictUntilTick).toBe(100 + CONFLICT_HOLD_TICKS);
  });

  it('reads no event as aimed at us when the frame names no local player', () => {
    const mood = nextMusicMood(CALM_MOOD, {
      events: [hitOn(10)],
      snapshot: snapshotAt(100),
      standing: { population: 0, stance: 'neutral' },
    });
    expect(mood.conflictUntilTick).toBe(0);
  });

  it('has no track for a jingle code, an unknown code, or a missing manifest', () => {
    const JINGLE_BIRTH = 23;
    expect(musicTrackFor(JINGLE_BIRTH, 'neutral', CALM_MOOD, 0, MANIFEST)).toBeNull();
    expect(musicTrackFor(999, 'neutral', CALM_MOOD, 0, MANIFEST)).toBeNull();
    expect(musicTrackFor(undefined, 'neutral', CALM_MOOD, 0, MANIFEST)).toBeNull();
    expect(musicTrackFor(THEME_VIKING, 'neutral', CALM_MOOD, 0, null)).toBeNull();
  });
});
