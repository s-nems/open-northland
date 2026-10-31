import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GameObjectNames } from '@open-northland/asset-pipeline/sources';
import { describe, expect, it } from 'vitest';
import { formatCsv, glossaryFromLanguageUnion, parseCsv } from '../../src/import/glossary.js';
import {
  driftedIds,
  readLocalizedObjectTable,
  sameGermanName,
  translateObjectNames,
} from '../../src/import/object-tables.js';

describe('sameGermanName', () => {
  it('reads a Han character of their garbled table as the umlaut and the byte it swallowed', () => {
    // cp1252 "ü" + "n" read as GBK is one Han character.
    expect(sameGermanName('Grüne Truhe', 'Gr黱e Truhe')).toBe(true);
    expect(sameGermanName('Bär ', 'B鋜')).toBe(true);
    expect(sameGermanName('Truhe', 'Kiste')).toBe(false);
    expect(sameGermanName('abc', 'a.c')).toBe(false);
  });
});

describe('object names', () => {
  const basis: GameObjectNames = {
    names: { 1: 'Truhe', 2: 'Grüne Truhe', 3: 'Fass' },
    plurals: { 1: 'Truhen', 2: 'Grüne Truhen', 3: 'Fässer' },
  };
  const theirGerman: GameObjectNames = {
    names: { 1: 'Truhe', 2: 'Gr黱e Truhe', 3: 'Kiste' },
    plurals: { 1: 'Truhen', 2: 'Gr黱e Truhen', 3: 'Kisten' },
  };
  const chinese: GameObjectNames = {
    names: { 1: '箱子', 2: '绿箱子', 3: '木箱', 9: '多余' },
    plurals: { 1: '箱子', 2: '', 3: '木箱' },
  };

  it('finds the ids whose German differs from ours', () => {
    expect(driftedIds(basis, theirGerman)).toEqual(['3']);
  });

  it('keeps the translated names our table knows, without drifted and blank ones', () => {
    expect(translateObjectNames(chinese, basis, ['3'])).toEqual({
      names: { '1': '箱子', '2': '绿箱子' },
      plurals: { '1': '箱子' },
      unknown: 1,
    });
  });
});

describe('description tables', () => {
  it("read a UTF-8 help table like the pack's, by explicit and running ids with marked line breaks", async () => {
    const root = await mkdtemp(join(tmpdir(), 'opennorthland-help-import-'));
    try {
      const dir = join(root, 'l10', 'strings', 'help');
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, 'goodshelp.ini'),
        '[control]\nstringidmultiplier 1\n[text]\nstringn 3 " 黏土 "\nstring "木头{newline}{newline}石头"\n',
      );

      expect(await readLocalizedObjectTable(root, 'l10', 'goodsHelp')).toEqual({
        names: { 3: '黏土', 4: '木头\n\n石头' },
        plurals: {},
      });
      expect(await readLocalizedObjectTable(root, 'l10', 'housesHelp')).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('glossary', () => {
  it('keeps the German, English, Polish and Chinese columns and the term notes', () => {
    const csv =
      '﻿ger,eng,fra,pol,l10(简体),l11(繁體),META_TYPE,META_DESCRIPTION,META_REFERENCES\n' +
      'Truhe,Chest,Coffre,Skrzynia,箱子,箱子,物品,"装东西的, 木制",map_a; map_b\n' +
      'Leer,Empty,Vide,Pusty,,,术语,,\n';
    const rows = glossaryFromLanguageUnion(csv);
    expect(rows).toEqual([
      ['ger', 'eng', 'pol', 'chs', 'cht', 'type', 'description', 'references'],
      ['Truhe', 'Chest', 'Skrzynia', '箱子', '箱子', '物品', '装东西的, 木制', 'map_a; map_b'],
    ]);
    expect(parseCsv(formatCsv(rows))).toEqual(rows);
  });
});
