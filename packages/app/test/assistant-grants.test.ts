import type { Command } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { assistantGrantsSeam, grantAssistantDefaults } from '../src/view/assistant-grants.js';

/** The seam translating the assistant window switches to `setAssistantGrant`, `setAssistantWeaponVeto` and
 *  `setAssistantGrantAudience` commands and back - good ids resolved from the live content by slug, so the
 *  fixture uses arbitrary ids. */

const CONTENT = {
  goods: [
    { typeId: 30, id: 'shoes' },
    { typeId: 31, id: 'tool_wooden' },
    { typeId: 32, id: 'tool_iron' },
    { typeId: 43, id: 'mead' },
    { typeId: 48, id: 'potion_heal_small' },
    { typeId: 49, id: 'potion_heal_big' },
    { typeId: 53, id: 'amulet_defense' },
    { typeId: 41, id: 'sword_shord' },
    { typeId: 39, id: 'spear_wooden' },
    { typeId: 37, id: 'bow_short' },
  ],
};

type AudienceKind = 'drink' | 'charm';

/** A sim face granting `granted`, vetoing `vetoed`, posting graduates when `posts`, moving flags when
 *  `movesFlags` and keeping `soldiersOnly` for soldiers. */
const simGranting = (
  granted: readonly number[],
  vetoed: readonly number[] = [],
  posts = false,
  movesFlags = false,
  soldiersOnly: readonly AudienceKind[] = [],
): {
  assistantGrants: () => readonly number[];
  assistantWeaponVetoes: () => readonly number[];
  assistantSoldierOnlyGrants: () => readonly AudienceKind[];
  assistantPostsGraduates: () => boolean;
  assistantMovesFlags: () => boolean;
} => ({
  assistantGrants: () => granted,
  assistantWeaponVetoes: () => vetoed,
  assistantSoldierOnlyGrants: () => soldiersOnly,
  assistantPostsGraduates: () => posts,
  assistantMovesFlags: () => movesFlags,
});

const SHOES = 30;
const TOOL_WOODEN = 31;
const TOOL_IRON = 32;
const MEAD = 43;
const HEAL_SMALL = 48;
const HEAL_BIG = 49;
const DEFENSE_AMULET = 53;
const SWORD_SHORT = 41;
const SPEAR_WOODEN = 39;

describe('assistantGrantsSeam', () => {
  it('reads every switch OFF and writes nothing while no seat is watched', () => {
    const sent: Command[] = [];
    const seam = assistantGrantsSeam(
      simGranting([SHOES, MEAD]),
      CONTENT,
      () => null,
      (c) => sent.push(c),
    );
    expect(seam.read().giveBoots).toBe(false);
    expect(seam.set('giveBoots', true)).toBe(false);
    expect(sent).toEqual([]);
  });

  it('reads a switch as ON exactly when its content-resolved goods are all granted', () => {
    const seam = assistantGrantsSeam(
      simGranting([SHOES, MEAD, HEAL_BIG, DEFENSE_AMULET], [], false, false, ['charm']),
      CONTENT,
      () => 0,
      () => {},
    );
    expect(seam.read()).toEqual({
      giveBoots: true,
      giveWoodenTools: false,
      giveIronTools: false,
      giveMead: true,
      giveFoodPotions: false,
      giveStaminaPotions: false,
      giveHealingPotions: false, // the big bottle alone: a half-granted potion reads OFF
      giveFoodAmulet: false,
      giveStaminaAmulet: false,
      giveStrengthAmulet: false,
      giveDefenseAmulet: true,
      giveCriticalHitAmulet: false,
      giveSpeedAmulet: false,
      allowShortSwords: true,
      allowWoodenSpears: true,
      allowShortBows: true,
      drinksForSoldiers: false,
      charmsForSoldiers: true,
      postGraduates: false,
      moveFlags: false,
    });
    expect(
      assistantGrantsSeam(
        simGranting([HEAL_SMALL, HEAL_BIG]),
        CONTENT,
        () => 0,
        () => {},
      ).read().giveHealingPotions,
    ).toBe(true);
  });

  it('writes a potion switch as one grant per bottle size, the big one first', () => {
    const sent: Command[] = [];
    const seam = assistantGrantsSeam(
      simGranting([]),
      CONTENT,
      () => 1,
      (c) => sent.push(c),
    );
    expect(seam.set('giveHealingPotions', true)).toBe(true);
    expect(sent).toEqual([
      { kind: 'setAssistantGrant', player: 1, goodType: HEAL_BIG, enabled: true },
      { kind: 'setAssistantGrant', player: 1, goodType: HEAL_SMALL, enabled: true },
    ]);
  });

  it('reads and writes an audience strip through the grant-audience command', () => {
    const sent: Command[] = [];
    const seam = assistantGrantsSeam(
      simGranting([], [], false, false, ['drink']),
      CONTENT,
      () => 2,
      (c) => sent.push(c),
    );
    expect(seam.read().drinksForSoldiers).toBe(true);
    expect(seam.read().charmsForSoldiers).toBe(false);
    expect(seam.set('drinksForSoldiers', false)).toBe(true);
    expect(seam.set('charmsForSoldiers', true)).toBe(true);
    expect(sent).toEqual([
      { kind: 'setAssistantGrantAudience', player: 2, grantKind: 'drink', soldiersOnly: false },
      { kind: 'setAssistantGrantAudience', player: 2, grantKind: 'charm', soldiersOnly: true },
    ]);
  });

  it('reads and writes the graduate switch through its own command', () => {
    const sent: Command[] = [];
    const seam = assistantGrantsSeam(
      simGranting([], [], true),
      CONTENT,
      () => 1,
      (c) => sent.push(c),
    );
    expect(seam.read().postGraduates).toBe(true);
    expect(seam.set('postGraduates', false)).toBe(true);
    expect(sent).toEqual([{ kind: 'setAssistantPostGraduates', player: 1, enabled: false }]);
  });

  it('reads and writes the flag switch through its own command', () => {
    const sent: Command[] = [];
    const seam = assistantGrantsSeam(
      simGranting([], [], false, true),
      CONTENT,
      () => 2,
      (c) => sent.push(c),
    );
    expect(seam.read().moveFlags).toBe(true);
    expect(seam.set('moveFlags', false)).toBe(true);
    expect(sent).toEqual([{ kind: 'setAssistantMoveFlags', player: 2, enabled: false }]);
  });

  it('reads a weapon switch as OFF while its good is vetoed, and writes the veto on a flip', () => {
    const sent: Command[] = [];
    const seam = assistantGrantsSeam(
      simGranting([], [SPEAR_WOODEN]),
      CONTENT,
      () => 3,
      (c) => sent.push(c),
    );
    expect(seam.read().allowWoodenSpears).toBe(false);
    expect(seam.read().allowShortSwords).toBe(true);
    expect(seam.set('allowShortSwords', false)).toBe(true);
    expect(seam.set('allowWoodenSpears', true)).toBe(true);
    expect(sent).toEqual([
      { kind: 'setAssistantWeaponVeto', player: 3, goodType: SWORD_SHORT, vetoed: true },
      { kind: 'setAssistantWeaponVeto', player: 3, goodType: SPEAR_WOODEN, vetoed: false },
    ]);
  });

  it('writes one command per mapped good, carrying the seat and the flip', () => {
    const sent: Command[] = [];
    const seam = assistantGrantsSeam(
      simGranting([]),
      CONTENT,
      () => 2,
      (c) => sent.push(c),
    );
    expect(seam.set('giveBoots', false)).toBe(true);
    expect(sent).toEqual([{ kind: 'setAssistantGrant', player: 2, goodType: SHOES, enabled: false }]);
  });

  it('a switch whose slug the content lacks reads OFF and rejects writes', () => {
    const sent: Command[] = [];
    const seam = assistantGrantsSeam(
      simGranting([SHOES]),
      { goods: [{ typeId: SHOES, id: 'shoes' }] },
      () => 0,
      (c) => sent.push(c),
    );
    expect(seam.read().giveMead).toBe(false);
    expect(seam.set('giveMead', true)).toBe(false);
    expect(sent).toEqual([]);
  });

  it('a read-only session rejects every write', () => {
    const sent: Command[] = [];
    const seam = assistantGrantsSeam(
      simGranting([]),
      CONTENT,
      () => 0,
      (c) => sent.push(c),
      false,
    );
    expect(seam.set('giveBoots', true)).toBe(false);
    expect(seam.set('moveFlags', true)).toBe(false);
    expect(sent).toEqual([]);
  });
});

describe('grantAssistantDefaults', () => {
  it('switches the four default grants ON for the seat at world start, no potion, amulet or veto', () => {
    const sent: Command[] = [];
    grantAssistantDefaults({ enqueueSetup: (c) => sent.push(c) }, CONTENT, [1]);
    expect(sent.every((c) => c.kind === 'setAssistantGrant')).toBe(true);
    const grants = sent.filter((c) => c.kind === 'setAssistantGrant');
    expect(grants.map((c) => c.goodType).sort((a, b) => a - b)).toEqual([
      SHOES,
      TOOL_WOODEN,
      TOOL_IRON,
      MEAD,
    ]);
    expect(grants.every((c) => c.enabled && c.player === 1)).toBe(true);
  });

  it('gives every played seat all four grants, a repeated seat only once', () => {
    const sent: Command[] = [];
    grantAssistantDefaults({ enqueueSetup: (c) => sent.push(c) }, CONTENT, [0, 2, 0]);
    const perSeat = new Map<number, number[]>();
    for (const c of sent.filter((c) => c.kind === 'setAssistantGrant')) {
      perSeat.set(
        c.player,
        [...(perSeat.get(c.player) ?? []), c.goodType].sort((a, b) => a - b),
      );
    }
    const all = [SHOES, TOOL_WOODEN, TOOL_IRON, MEAD].sort((a, b) => a - b);
    expect([...perSeat.keys()].sort((a, b) => a - b)).toEqual([0, 2]);
    expect(perSeat.get(0)).toEqual(all);
    expect(perSeat.get(2)).toEqual(all);
  });
});
