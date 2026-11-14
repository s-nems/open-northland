import type { AssistantGrantGroup, Command } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { assistantGrantsSeam, startAssistantSwitches } from '../../../src/view/assistant/grants.js';

/** The seam translating the assistant window switches to `setAssistantGrant` and
 *  `setAssistantGrantAudience` commands and back - good ids resolved from the live content by slug, so the
 *  fixture uses arbitrary ids. */

const NONE_WITHHELD = { civilians: [], workers: [], soldiers: [] };

const CONTENT = {
  goods: [
    { typeId: 30, id: 'shoes' },
    { typeId: 31, id: 'tool_wooden' },
    { typeId: 32, id: 'tool_iron' },
    { typeId: 43, id: 'mead' },
    { typeId: 48, id: 'potion_heal_small' },
    { typeId: 49, id: 'potion_heal_big' },
    { typeId: 53, id: 'amulet_defense' },
  ],
};

/** A sim face granting `granted`, posting graduates when `posts`, moving flags when `movesFlags`,
 *  withholding `withheld` goods from each group. */
const simGranting = (
  granted: readonly number[],
  posts = false,
  movesFlags = false,
  withheld: Readonly<Record<AssistantGrantGroup, readonly number[]>> = NONE_WITHHELD,
): {
  assistantGrants: () => readonly number[];
  assistantWithheldGrants: () => Readonly<Record<AssistantGrantGroup, readonly number[]>>;
  assistantPostsGraduates: () => boolean;
  assistantMovesFlags: () => boolean;
  assistantUpgradesTools: () => boolean;
  assistantFoundsFamilies: () => boolean;
} => ({
  assistantGrants: () => granted,
  assistantWithheldGrants: () => withheld,
  assistantPostsGraduates: () => posts,
  assistantMovesFlags: () => movesFlags,
  assistantUpgradesTools: () => false,
  assistantFoundsFamilies: () => false,
});

const SHOES = 30;
const MEAD = 43;
const HEAL_SMALL = 48;
const HEAL_BIG = 49;
const DEFENSE_AMULET = 53;

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
      simGranting([SHOES, MEAD, HEAL_BIG, DEFENSE_AMULET]),
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
      upgradeTools: false,
      postGraduates: false,
      moveFlags: false,
      foundFamilies: false,
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

  it('reads a group as receiving a switch while none of its goods is withheld from it, and writes the groups per good', () => {
    const sent: Command[] = [];
    const withheld = { civilians: [DEFENSE_AMULET, HEAL_SMALL], workers: [DEFENSE_AMULET], soldiers: [MEAD] };
    const seam = assistantGrantsSeam(
      simGranting([], false, false, withheld),
      CONTENT,
      () => 2,
      (c) => sent.push(c),
    );
    const audiences = seam.readAudiences();
    expect(audiences.giveDefenseAmulet).toEqual(['soldiers']);
    expect(audiences.giveHealingPotions).toEqual(['workers', 'soldiers']); // one bottle withheld is enough
    expect(audiences.giveMead).toEqual(['civilians', 'workers']);
    expect(seam.setAudience('giveHealingPotions', ['soldiers'])).toBe(true);
    expect(seam.setAudience('giveMead', ['civilians', 'workers', 'soldiers'])).toBe(true);
    expect(sent).toEqual([
      { kind: 'setAssistantGrantAudience', player: 2, goodType: HEAL_BIG, groups: ['soldiers'] },
      { kind: 'setAssistantGrantAudience', player: 2, goodType: HEAL_SMALL, groups: ['soldiers'] },
      {
        kind: 'setAssistantGrantAudience',
        player: 2,
        goodType: MEAD,
        groups: ['civilians', 'workers', 'soldiers'],
      },
    ]);
  });

  it('reads and writes the graduate switch through its own command', () => {
    const sent: Command[] = [];
    const seam = assistantGrantsSeam(
      simGranting([], true),
      CONTENT,
      () => 1,
      (c) => sent.push(c),
    );
    expect(seam.read().postGraduates).toBe(true);
    expect(seam.set('postGraduates', false)).toBe(true);
    expect(sent).toEqual([{ kind: 'setAssistantPostGraduates', player: 1, enabled: false }]);
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
    expect(seam.setAudience('giveMead', ['soldiers'])).toBe(false);
    expect(sent).toEqual([]);
  });
});

describe('startAssistantSwitches', () => {
  it('switches only the tool upgrade on at world start, once per seat: every give switch and the flag follow start off', () => {
    const sent: Command[] = [];
    startAssistantSwitches({ enqueueSetup: (c) => sent.push(c) }, [0, 2, 0]);
    expect(sent).toEqual([
      { kind: 'setAssistantUpgradeTools', player: 0, enabled: true },
      { kind: 'setAssistantUpgradeTools', player: 2, enabled: true },
    ]);
  });
});
