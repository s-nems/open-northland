import { describe, expect, it } from 'vitest';
import { defaultBindings, VIKING_VOICE_POOLS } from '../src/index.js';

/**
 * The event→sound bindings: the "which sound answers which happening" layer, plus the voice-pool
 * listing the `?sounds` gallery auditions (in play a voice resolves by `logicSoundType` id from the
 * clip's authored `atomicSound` cue, not from these pools).
 */

describe('VIKING_VOICE_POOLS', () => {
  it('gives every voice class a non-empty, sex-appropriate pool', () => {
    for (const cls of ['male', 'female', 'child'] as const) {
      expect(VIKING_VOICE_POOLS[cls].length).toBeGreaterThan(0);
    }
    // The male and female pools are disjoint - no cross-sex group leaks into the other.
    const male = new Set(VIKING_VOICE_POOLS.male);
    expect(VIKING_VOICE_POOLS.female.some((g) => male.has(g))).toBe(false);
  });
});

describe('defaultBindings', () => {
  it('binds life events to jingles and placement/production to spatial groups', () => {
    const b = defaultBindings();
    expect(b.byEvent.buildingFinished?.kind).toBe('jingle');
    expect(b.byEvent.settlerBorn?.kind).toBe('jingle');
    expect(b.byEvent.buildingPlaced).toEqual({ kind: 'spatial', group: 'Hammer Wood' });
    expect(b.byEvent.goodProduced).toEqual({ kind: 'spatial', group: 'Carpenter Saw' });
  });

  it('marks every life-event jingle own-player-only and screen-gated', () => {
    const b = defaultBindings();
    for (const kind of ['buildingFinished', 'settlerBorn', 'settlerDied'] as const) {
      const jingle = b.byEvent[kind];
      expect(jingle?.kind).toBe('jingle');
      expect(jingle?.kind === 'jingle' && jingle.localPlayerOnly).toBe(true);
      expect(jingle?.kind === 'jingle' && jingle.screenGated).toBe(true);
    }
  });

  it('rings the civil-defence bells map-wide, only for the player who raised the alarm', () => {
    const alarm = defaultBindings().byEvent.defenceAlarmRaised;
    expect(alarm).toEqual({ kind: 'jingle', musicType: 24, localPlayerOnly: true });
  });

  it('binds the impacts, plus the swing the attack clip does not sound itself', () => {
    const b = defaultBindings();
    expect(b.byEvent.combatHit).toEqual({ kind: 'spatial', group: 'Weapon Sword Short Hit' });
    expect(b.byEvent.projectileHit).toEqual({ kind: 'spatial', group: 'Weapon Bow Hit' });
    // The generic swoosh covers a body whose clip authors none - a hero, or a beast. The sim withholds
    // `combatSwing` from a cued clip, so this never doubles a per-weapon cue.
    expect(b.byEvent.combatSwing).toEqual({ kind: 'spatial', group: 'Weapon Sword Short' });
    // No release entry: `projectileLaunched` fires whether or not the clip sounds, and every ranged clip
    // in the data authors its own bowstring.
    expect(b.byEvent.projectileLaunched).toBeUndefined();
    // Per-weapon melee impacts: fist / spear / sword (mainType 1 / 2 / 3).
    expect(b.byCombatWeapon?.get(1)).toEqual({ kind: 'spatial', group: 'Weapon Fist Hit' });
    expect(b.byCombatWeapon?.get(2)).toEqual({ kind: 'spatial', group: 'Weapon Spear Hit' });
    expect(b.byCombatWeapon?.get(3)).toEqual({ kind: 'spatial', group: 'Weapon Sword Short Hit' });
  });
});
