import { describe, expect, it } from 'vitest';
import {
  characterStem,
  characterStems,
  DEFAULT_CHARACTER,
  findCharacter,
  headLabel,
  pickWalkRow,
  VIKING_CHARACTERS,
} from '../src/catalog/roster.js';
import type { BobSeqRow } from '../src/content/ir/rows.js';

/**
 * The viking roster's pure half — the shape/consistency of the `jobgraphics.ini` transcription,
 * self-verifiable on any checkout. The pin that decoded `content/` actually carries every body
 * imagelib + head/body atlas the roster names lives in the real-content suite
 * (`test/content/viking-roster.test.ts`).
 */

describe('findCharacter', () => {
  it('resolves a known id and falls back to the civilian for absent/unknown', () => {
    expect(findCharacter('warrior').id).toBe('warrior');
    expect(findCharacter(null)).toBe(DEFAULT_CHARACTER);
    expect(findCharacter('nope')).toBe(DEFAULT_CHARACTER);
    expect(DEFAULT_CHARACTER.id).toBe('civilian');
  });
});

describe('character stems', () => {
  it('appends the palette to a bmd stem', () => {
    expect(characterStem('cr_hum_body_05')).toBe('cr_hum_body_05.test_human_00');
    expect(characterStem('cr_hum_head_10', 'egypt_soldier')).toBe('cr_hum_head_10.egypt_soldier');
  });

  it('resolves a character to its body + head stems in roster order', () => {
    const warrior = findCharacter('warrior');
    const { bodyStem, headStems } = characterStems(warrior);
    expect(bodyStem).toBe('cr_hum_body_05.test_human_00');
    expect(headStems).toEqual([
      'cr_hum_head_05.test_human_00',
      'cr_hum_head_06.test_human_00',
      'cr_hum_head_07.test_human_00',
      'cr_hum_head_08.test_human_00',
    ]);
  });
});

describe('headLabel', () => {
  it('reads the head index out of the bmd stem', () => {
    expect(headLabel('cr_hum_head_08')).toBe('Głowa 08');
    expect(headLabel('cr_hum_head_93')).toBe('Głowa 93');
    expect(headLabel('something_else')).toBe('something_else');
  });
});

describe('pickWalkRow', () => {
  const row = (name: string, length: number): BobSeqRow => ({ name, start: 0, length });

  it('prefers a plain ×8 "_walk" over an agressive/carry variant', () => {
    const rows = [
      row('human_man_Warrior_Broadsword_wait', 22),
      row('human_man_Warrior_Broadsword_walk_agressive', 96),
      row('human_man_Warrior_Broadsword_walk', 96),
    ];
    expect(pickWalkRow(rows)?.name).toBe('human_man_Warrior_Broadsword_walk');
  });

  it('falls back to the longest ×8 clip when no "_walk" exists (the baby has only crouch)', () => {
    const rows = [row('human_child_baby_generic_wait', 42), row('human_child_baby_generic_crouch', 104)];
    expect(pickWalkRow(rows)?.name).toBe('human_child_baby_generic_crouch');
  });

  it('falls back to the first row when nothing is ×8, and is undefined for []', () => {
    expect(pickWalkRow([row('a', 7), row('b', 5)])?.name).toBe('a');
    expect(pickWalkRow([])).toBeUndefined();
  });
});

describe('roster shape', () => {
  it('has unique ids and well-formed body/head/imagelib names', () => {
    const ids = VIKING_CHARACTERS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of VIKING_CHARACTERS) {
      expect(c.bodyBmd, c.id).toMatch(/^cr_hum_body_\d{2}$/);
      expect(c.imagelib, c.id).toBe(`${c.bodyBmd}.bmd`);
      // headBmds MAY be empty (a body-only creature); every listed head is well-formed.
      for (const h of c.headBmds) expect(h, c.id).toMatch(/^cr_hum_head_\d{2}$/);
    }
    // The civilian carries multiple looks (the heads montage is meaningful); the baby is body-only.
    expect(findCharacter('civilian').headBmds.length).toBeGreaterThan(1);
    expect(findCharacter('baby').headBmds).toEqual([]);
  });

  it('includes the warrior with its combat body and several looks', () => {
    const warrior = findCharacter('warrior');
    expect(warrior.imagelib).toBe('cr_hum_body_05.bmd');
    expect(warrior.headBmds.length).toBe(4);
  });
});
