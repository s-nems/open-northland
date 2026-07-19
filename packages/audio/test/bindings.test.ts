import { describe, expect, it } from 'vitest';
import { defaultBindings, VIKING_VOICE_POOLS } from '../src/index.js';

/**
 * The event→sound bindings: the "which sound answers which happening" layer, plus the voice-pool
 * listing the `?sounds` gallery auditions (in play a voice resolves by `logicSoundType` id from the
 * sim's `chatVoice` cue, not from these pools).
 */

describe('VIKING_VOICE_POOLS', () => {
  it('gives every voice class a non-empty, sex-appropriate pool', () => {
    for (const cls of ['male', 'female', 'child'] as const) {
      expect(VIKING_VOICE_POOLS[cls].length).toBeGreaterThan(0);
    }
    // The male and female pools are disjoint — no cross-sex group leaks into the other.
    const male = new Set(VIKING_VOICE_POOLS.male);
    expect(VIKING_VOICE_POOLS.female.some((g) => male.has(g))).toBe(false);
  });
});

describe('defaultBindings', () => {
  it('binds the chop / build atomics to spatial groups only when their ids are given', () => {
    expect(defaultBindings().byAtomic.size).toBe(0);
    expect(defaultBindings().byAtomicSound.size).toBe(0);
    // The chop sounds at swing completion (byAtomic → atomicCompleted).
    const chop = defaultBindings({ chopAtomicId: 24 }).byAtomic.get(24);
    expect(chop).toEqual({ kind: 'spatial', group: 'Woodcutter Axe' });
    // The builder's hammer knocks mid-swing at its PLAY_SOUND_FX cue (byAtomicSound → atomicSound), the
    // per-swing twin of the buildingPlaced hammer — not on byAtomic, so it never doubles at completion.
    const build = defaultBindings({ buildAtomicId: 39 });
    expect(build.byAtomicSound.get(39)).toEqual({ kind: 'spatial', group: 'Hammer Wood' });
    expect(build.byAtomic.has(39)).toBe(false);
    // Both ids together bind their atomics independently, each on its own map.
    const both = defaultBindings({ chopAtomicId: 24, buildAtomicId: 39 });
    expect(both.byAtomic.size).toBe(1);
    expect(both.byAtomicSound.size).toBe(1);
  });

  it('binds life events to jingles and placement/production to spatial groups', () => {
    const b = defaultBindings();
    expect(b.byEvent.buildingFinished?.kind).toBe('jingle');
    expect(b.byEvent.settlerBorn?.kind).toBe('jingle');
    expect(b.byEvent.buildingPlaced).toEqual({ kind: 'spatial', group: 'Hammer Wood' });
    expect(b.byEvent.goodProduced).toEqual({ kind: 'spatial', group: 'Carpenter Saw' });
  });

  it('marks only the death jingle local-player-only (a birth rings for everyone)', () => {
    const b = defaultBindings();
    const death = b.byEvent.settlerDied;
    expect(death?.kind).toBe('jingle');
    expect(death?.kind === 'jingle' && death.localPlayerOnly).toBe(true);
    const born = b.byEvent.settlerBorn;
    expect(born?.kind === 'jingle' && born.localPlayerOnly).toBeFalsy();
  });

  it('binds combat impacts: melee hit + bow shot/hit, with weapon-specific melee groups', () => {
    const b = defaultBindings();
    expect(b.byEvent.combatHit).toEqual({ kind: 'spatial', group: 'Weapon Sword Short Hit' });
    expect(b.byEvent.projectileLaunched).toEqual({ kind: 'spatial', group: 'Weapon Bow Long' });
    expect(b.byEvent.projectileHit).toEqual({ kind: 'spatial', group: 'Weapon Bow Hit' });
    // Per-weapon melee impacts: fist / spear / sword (mainType 1 / 2 / 3).
    expect(b.byCombatWeapon?.get(1)).toEqual({ kind: 'spatial', group: 'Weapon Fist Hit' });
    expect(b.byCombatWeapon?.get(2)).toEqual({ kind: 'spatial', group: 'Weapon Spear Hit' });
    expect(b.byCombatWeapon?.get(3)).toEqual({ kind: 'spatial', group: 'Weapon Sword Short Hit' });
  });
});
