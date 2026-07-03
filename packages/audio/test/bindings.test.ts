import { describe, expect, it } from 'vitest';
import { VIKING_VOICE_POOLS, defaultBindings, vikingVoiceClass } from '../src/index.js';

/**
 * The event→sound bindings + the settler voice classification: the "which sound answers which happening"
 * layer. `vikingVoiceClass` mirrors the render roster's job→body split (the `woman` job is female, an
 * `Age`-carrying settler is a child, everyone else male), so a settler sounds like the body it draws.
 */

const WOMAN_JOB = 5; // the mod's viking woman job (jobtypes.ini) — the one adult female look/voice.

describe('vikingVoiceClass', () => {
  it('classifies an Age-carrying settler as a child regardless of job', () => {
    expect(vikingVoiceClass(4, true)).toBe('child'); // child_male job, still young
    expect(vikingVoiceClass(WOMAN_JOB, true)).toBe('child'); // young wins over the woman job
    expect(vikingVoiceClass(null, true)).toBe('child');
  });

  it('classifies the adult woman job as female and every other adult as male', () => {
    expect(vikingVoiceClass(WOMAN_JOB, false)).toBe('female');
    expect(vikingVoiceClass(0, false)).toBe('male'); // idle civilian
    expect(vikingVoiceClass(31, false)).toBe('male'); // a soldier
    expect(vikingVoiceClass(null, false)).toBe('male'); // unemployed adult
  });
});

describe('VIKING_VOICE_POOLS', () => {
  it('gives every voice class a non-empty, sex-appropriate pool', () => {
    for (const cls of ['male', 'female', 'child'] as const) {
      expect(VIKING_VOICE_POOLS[cls].length).toBeGreaterThan(0);
    }
    // The male and female pools are disjoint (no cross-sex group leaks into the other) — the whole point.
    const male = new Set(VIKING_VOICE_POOLS.male);
    expect(VIKING_VOICE_POOLS.female.some((g) => male.has(g))).toBe(false);
  });
});

describe('defaultBindings', () => {
  it('binds the chop atomic to a spatial group only when a chop atomic id is given', () => {
    expect(defaultBindings().byAtomic.size).toBe(0);
    const chop = defaultBindings({ chopAtomicId: 24 }).byAtomic.get(24);
    expect(chop).toEqual({ kind: 'spatial', group: 'Woodcutter Axe' });
  });

  it('binds life events to jingles and placement/production to spatial groups', () => {
    const b = defaultBindings();
    expect(b.byEvent.buildingFinished?.kind).toBe('jingle');
    expect(b.byEvent.settlerBorn?.kind).toBe('jingle');
    expect(b.byEvent.buildingPlaced).toEqual({ kind: 'spatial', group: 'Hammer Wood' });
    expect(b.byEvent.goodProduced).toEqual({ kind: 'spatial', group: 'Carpenter Saw' });
  });
});
