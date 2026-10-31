import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PersonalNamePool } from '@open-northland/data';
import { afterEach, describe, expect, it } from 'vitest';
import type { OverlayFile } from '../../src/import/maps.js';
import { importPersonalNames } from '../../src/import/personal-names.js';

/** The sex tag settles two pools that carry one name; the rest of the lines carry one name each. */
const ENGLISH = [
  '[names]',
  'logictribe 1',
  'Name 0 "Adam"',
  'Name 0 "Ali"',
  'Name 1 "Ali"',
  'Name 1 "Sigrid"',
  'logictribe 4',
  'Name 0 "Harun"',
  '',
].join('\r\n');
const SIMPLIFIED = [
  '[names]',
  'logictribe 1',
  'Name 0 "亚当"',
  'Name 0 "阿里"',
  'Name 1 "阿莉"',
  'Name 1 "西格里德"',
  'logictribe 4',
  'Name 0 "哈伦"',
  '',
].join('\r\n');
const TRADITIONAL = [
  '[names]',
  'logictribe 1',
  'Name 0 "亞當"',
  'Name 0 "阿里"',
  'Name 1 "阿莉"',
  'Name 1 "西格里德"',
  'logictribe 4',
  'Name 0 "哈倫"',
  '',
].join('\r\n');

const roots: string[] = [];

async function source(
  english = ENGLISH,
  simplified = SIMPLIFIED,
  traditional = TRADITIONAL,
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'on-personal-names-'));
  roots.push(root);
  const folders = [
    ['eng', english],
    ['l10', simplified],
    ['l11', traditional],
  ] as const;
  for (const [folder, text] of folders) {
    const dir = join(root, folder, 'strings', 'gameobjects');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'humannames.ini'), text);
  }
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const pool = (id: string, sex: PersonalNamePool['sex'], names: readonly string[]): PersonalNamePool => ({
  id,
  tribe: 1,
  sex,
  names: [...names],
});

/** The overlay a run wrote for one language and pool, or undefined when it wrote none. */
function overlayOf(files: readonly OverlayFile[], path: string): Record<string, string> | undefined {
  const file = files.find((entry) => entry.path === path);
  return file === undefined ? undefined : (file.value as { names: Record<string, string> }).names;
}

describe('importPersonalNames', () => {
  it('takes the line the pool sex names, so a shared name keeps two translations', async () => {
    const files: OverlayFile[] = [];
    await importPersonalNames(await source(), files, [
      pool('viking-male', 'male', ['Ali']),
      pool('viking-female', 'female', ['Ali']),
    ]);
    expect(overlayOf(files, 'chs/names/viking-male.json')).toEqual({ Ali: '阿里' });
    expect(overlayOf(files, 'chs/names/viking-female.json')).toEqual({ Ali: '阿莉' });
  });

  it('writes one file per language, translated from that language folder', async () => {
    const files: OverlayFile[] = [];
    await importPersonalNames(await source(), files, [pool('viking-male', 'male', ['Adam'])]);
    expect(overlayOf(files, 'chs/names/viking-male.json')).toEqual({ Adam: '亚当' });
    expect(overlayOf(files, 'cht/names/viking-male.json')).toEqual({ Adam: '亞當' });
  });

  it('keeps only the names its pool generates, and writes no file for an empty pool', async () => {
    const files: OverlayFile[] = [];
    const result = await importPersonalNames(await source(), files, [
      pool('viking-male', 'male', ['Adam', 'Nobody']),
      pool('frank-male', 'male', ['Nobody']),
    ]);
    expect(overlayOf(files, 'chs/names/viking-male.json')).toEqual({ Adam: '亚当' });
    expect(overlayOf(files, 'chs/names/frank-male.json')).toBeUndefined();
    expect(result.languages.chs).toEqual({ names: 1 });
  });

  it('takes a sole translation even when the pool sorts the name under the other sex', async () => {
    // The source tags Gunnlaug on a man's line while the female pool carries it: one translation
    // serves either reading, so the pool still gets it.
    const english = ['[names]', 'logictribe 1', 'Name 0 "Gunnlaug"', ''].join('\r\n');
    const text = ['[names]', 'logictribe 1', 'Name 0 "贡劳格"', ''].join('\r\n');
    const files: OverlayFile[] = [];
    await importPersonalNames(await source(english, text, text), files, [
      pool('viking-female', 'female', ['Gunnlaug']),
    ]);
    expect(overlayOf(files, 'chs/names/viking-female.json')).toEqual({ Gunnlaug: '贡劳格' });
  });

  it('leaves out a name the table spells twice with two different translations', async () => {
    // The localization gives one name two readings in the same sex; picking either would be a guess.
    const english = ['[names]', 'logictribe 1', 'Name 0 "Thorkel"', 'Name 0 "Thorkel"', ''].join('\r\n');
    const text = ['[names]', 'logictribe 1', 'Name 0 "托尔克尔"', 'Name 0 "索尔克尔"', ''].join('\r\n');
    const files: OverlayFile[] = [];
    await importPersonalNames(await source(english, text, text), files, [
      pool('viking-male', 'male', ['Thorkel']),
    ]);
    expect(overlayOf(files, 'chs/names/viking-male.json')).toBeUndefined();
  });

  it('never translates the line the original leaves a settler unnamed on', async () => {
    const english = ['[names]', 'logictribe 5', 'Name 1 "Unnamed weresnake woman"', ''].join('\r\n');
    const text = ['[names]', 'logictribe 5', 'Name 1 "未命名蛇人女性"', ''].join('\r\n');
    const files: OverlayFile[] = [];
    await importPersonalNames(await source(english, text, text), files, [
      pool('weresnake-neutral', 'neutral', ['Unnamed weresnake woman']),
    ]);
    expect(overlayOf(files, 'chs/names/weresnake-neutral.json')).toBeUndefined();
  });

  it('ignores a translated line whose sex tag the English line does not repeat', async () => {
    // The translation moved a name onto the other sex's line: its row is not this name's text.
    const shifted = SIMPLIFIED.replace('Name 0 "亚当"', 'Name 1 "亚当"');
    const files: OverlayFile[] = [];
    await importPersonalNames(await source(ENGLISH, shifted), files, [pool('viking-male', 'male', ['Adam'])]);
    expect(overlayOf(files, 'chs/names/viking-male.json')).toBeUndefined();
  });

  it('leaves a name out when its line is missing from the translation', async () => {
    const short = SIMPLIFIED.replace('Name 0 "哈伦"\n', '').replace('Name 0 "哈伦"\r\n', '');
    const files: OverlayFile[] = [];
    await importPersonalNames(await source(ENGLISH, short), files, [pool('saracen-male', 'male', ['Harun'])]);
    expect(overlayOf(files, 'chs/names/saracen-male.json')).toBeUndefined();
  });
});
