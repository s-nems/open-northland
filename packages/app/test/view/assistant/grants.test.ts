import type { Command } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { assistantGrantsSeam, startAssistantSwitches } from '../../../src/view/assistant/grants.js';

/** The seam translating the assistant window switches to `setAssistantGrant` and
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
  ],
};

/** A sim face granting `granted`, posting graduates when `posts`, moving flags when
 *  `movesFlags`, keeping `soldiersOnly` for soldiers and `civiliansOnly` for civilians. */
const simGranting = (
  granted: readonly number[],
  posts = false,
  movesFlags = false,
  soldiersOnly: readonly number[] = [],
  civiliansOnly: readonly number[] = [],
): {
  assistantGrants: () => readonly number[];
  assistantSoldierOnlyGrants: () => readonly number[];
  assistantCivilianOnlyGrants: () => readonly number[];
  assistantPostsGraduates: () => boolean;
  assistantMovesFlags: () => boolean;
  assistantUpgradesTools: () => boolean;
} => ({
  assistantGrants: () => granted,
  assistantSoldierOnlyGrants: () => soldiersOnly,
  assistantCivilianOnlyGrants: () => civiliansOnly,
  assistantPostsGraduates: () => posts,
  assistantMovesFlags: () => movesFlags,
  assistantUpgradesTools: () => false,
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

  it("reads a switch as one group's when every good it grants is limited to it, and writes one audience per good", () => {
    const sent: Command[] = [];
    const seam = assistantGrantsSeam(
      simGranting([], false, false, [DEFENSE_AMULET, HEAL_BIG], [MEAD]),
      CONTENT,
      () => 2,
      (c) => sent.push(c),
    );
    const audiences = seam.readAudiences();
    expect(audiences.giveDefenseAmulet).toBe('soldiers');
    expect(audiences.giveHealingPotions).toBe('everyone'); // the small bottle is open to everyone
    expect(audiences.giveMead).toBe('civilians');
    expect(seam.setAudience('giveHealingPotions', 'soldiers')).toBe(true);
    expect(seam.setAudience('giveDefenseAmulet', 'civilians')).toBe(true);
    expect(seam.setAudience('giveMead', 'everyone')).toBe(true);
    expect(sent).toEqual([
      { kind: 'setAssistantGrantAudience', player: 2, goodType: HEAL_BIG, audience: 'soldiers' },
      { kind: 'setAssistantGrantAudience', player: 2, goodType: HEAL_SMALL, audience: 'soldiers' },
      { kind: 'setAssistantGrantAudience', player: 2, goodType: DEFENSE_AMULET, audience: 'civilians' },
      { kind: 'setAssistantGrantAudience', player: 2, goodType: MEAD, audience: 'everyone' },
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
    expect(seam.setAudience('giveMead', 'soldiers')).toBe(false);
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
