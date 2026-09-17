import { describe, expect, it } from 'vitest';
import { defaultBindings } from '../src/index.js';

/**
 * The event→sound bindings: the "which sound answers which happening" layer. A settler's voice never
 * binds here - it resolves from the creature voice tables by tribe and class, or by `logicSoundType` id
 * from a clip's authored `atomicSound` cue.
 */

describe('defaultBindings', () => {
  it('binds life events to jingles and production to spatial groups', () => {
    const b = defaultBindings();
    expect(b.byEvent.buildingFinished?.kind).toBe('jingle');
    expect(b.byEvent.settlerBorn?.kind).toBe('jingle');
    expect(b.byEvent.buildingPlaced).toBeUndefined();
    expect(b.byEvent.goodProduced).toEqual({ kind: 'spatial', group: 'Carpenter Saw' });
    // Positioned, for every owner: an enemy's house falls as audibly as our own.
    expect(b.byEvent.buildingDestroyed).toEqual({ kind: 'spatial', group: 'House Crash' });
  });

  it('binds chest opening to its kind-specific lid sound and the local-player jingle', () => {
    const b = defaultBindings();
    expect(b.byChestKind).toEqual({
      wooden: { kind: 'spatial', group: 'Open Wooden Chest' },
      magical: { kind: 'spatial', group: 'Open Magical Chest' },
    });
    expect(b.byEvent.chestOpened).toEqual({
      kind: 'jingle',
      musicType: 30,
      localPlayerOnly: true,
    });
  });

  it('marks every life-event jingle own-player-only and screen-gated', () => {
    const b = defaultBindings();
    for (const kind of ['buildingFinished', 'settlerBorn', 'settlersMarried', 'settlerDied'] as const) {
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

  it('binds the swing the attack clip does not sound itself, and leaves the impacts to the weapon data', () => {
    const b = defaultBindings();
    // The generic swoosh covers a body whose clip authors none - a hero, or a beast. The sim withholds
    // `combatSwing` from a cued clip, so this never doubles a per-weapon cue.
    expect(b.byEvent.combatSwing).toEqual({ kind: 'spatial', group: 'Weapon Sword Short' });
    // No release entry: `projectileLaunched` fires whether or not the clip sounds, and every ranged clip
    // in the data authors its own bowstring. No impact entries either: a hit or a miss names its group by
    // the `logicSoundType` id the weapon's `soundtype_Hit` / `soundtype_NoHit` tables put on the event.
    expect(b.byEvent.projectileLaunched).toBeUndefined();
    expect(b.byEvent.combatHit).toBeUndefined();
    expect(b.byEvent.projectileHit).toBeUndefined();
    expect(b.byEvent.projectileMissed).toBeUndefined();
  });

  it("rings a script's briefing and earthquake through the hardwired cues", () => {
    const b = defaultBindings();
    expect(b.byEvent.missionCutscene).toEqual({ kind: 'cue', cue: 'briefing' });
    expect(b.byEvent.missionEarthquake).toEqual({ kind: 'cue', cue: 'earthquake' });
  });
});
