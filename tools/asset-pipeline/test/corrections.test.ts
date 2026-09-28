import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CORRECTIONS_DIR, loadSourceCorrections } from '../src/corrections.js';
import { readSourceFile } from '../src/roots.js';
import { convertMapDatTree } from '../src/stages/maps/index.js';
import { buildMapDat } from './fixtures/mapdat.js';
import { makeTempDir, type TempDir } from './support/game-tree.js';

const MAP_FOLDER = 'CnModMaps/Swapped Camps';
const AI_INC = `${MAP_FOLDER}/ai.inc`;
const SHIPPED_AI =
  '[aidata]\r\nAI_SoldiersDefaultPosition 1 40 2 50\r\nAI_UnitLimit 1 30\r\n' +
  'AI_SoldiersDefaultPosition 2 10 90 55\r\n';
const SWAP = [
  { from: 'AI_SoldiersDefaultPosition 1 40 2 50', to: 'AI_SoldiersDefaultPosition 1 10 90 55' },
  { from: 'AI_SoldiersDefaultPosition 2 10 90 55', to: 'AI_SoldiersDefaultPosition 2 40 2 50' },
];

const sha256 = (text: string): string => createHash('sha256').update(text, 'latin1').digest('hex');

describe('source corrections', () => {
  let temp: TempDir;
  let mod: string;
  let dir: string;

  const writeCorrection = (id: string, correction: object): Promise<void> =>
    writeFile(join(dir, `${id}.json`), JSON.stringify(correction));
  const writeMod = async (rel: string, data: string | Uint8Array): Promise<string> => {
    const path = join(mod, rel);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, typeof data === 'string' ? Buffer.from(data, 'latin1') : data);
    return path;
  };

  beforeEach(async () => {
    temp = await makeTempDir('corrections');
    mod = join(temp.path, 'mod');
    dir = join(temp.path, 'corrections');
    await mkdir(dir, { recursive: true });
  });

  afterEach(() => temp.cleanup());

  it('swaps the named lines and keeps every other byte of that file', async () => {
    const path = await writeMod(AI_INC, SHIPPED_AI);
    const other = await writeMod(`${MAP_FOLDER}/player.inc`, 'AI_SoldiersDefaultPosition 1 40 2 50\n');
    await writeCorrection('swap', { reason: 'test', file: AI_INC, sha256: sha256(SHIPPED_AI), lines: SWAP });
    const corrections = await loadSourceCorrections(dir, mod);

    expect(Buffer.from(await corrections.read(path)).toString('latin1')).toBe(
      '[aidata]\r\nAI_SoldiersDefaultPosition 1 10 90 55\r\nAI_UnitLimit 1 30\r\n' +
        'AI_SoldiersDefaultPosition 2 40 2 50\r\n',
    );
    expect(Buffer.from(await corrections.read(other)).toString('latin1')).toBe(
      'AI_SoldiersDefaultPosition 1 40 2 50\n',
    );
    expect(() => corrections.assertApplied()).not.toThrow();
  });

  it('reads a changed file as shipped and fails the run until the correction is revisited', async () => {
    const path = await writeMod(AI_INC, `${SHIPPED_AI}AI_UnitLimit 2 30\r\n`);
    await writeCorrection('swap', { reason: 'test', file: AI_INC, sha256: sha256(SHIPPED_AI), lines: SWAP });
    const corrections = await loadSourceCorrections(dir, mod);

    expect(Buffer.from(await corrections.read(path)).toString('latin1')).toContain(SWAP[0]?.from);
    expect(() => corrections.assertApplied()).toThrow(/swap \(.*ai\.inc\): the file changed/);
  });

  it('fails the run for a correction no stage read', async () => {
    await writeCorrection('swap', { reason: 'test', file: AI_INC, sha256: sha256(SHIPPED_AI), lines: SWAP });
    const corrections = await loadSourceCorrections(dir, mod);
    expect(() => corrections.assertApplied()).toThrow(/swap .*never read/);
  });

  it('fails the run for a line matching no line or several', async () => {
    const shipped = 'a\r\na\r\n';
    const path = await writeMod(AI_INC, shipped);
    for (const from of ['a', 'b']) {
      await writeCorrection('lines', {
        reason: 'test',
        file: AI_INC,
        sha256: sha256(shipped),
        lines: [{ from, to: 'c' }],
      });
      const corrections = await loadSourceCorrections(dir, mod);
      expect(Buffer.from(await corrections.read(path)).toString('latin1')).toBe(shipped);
      expect(() => corrections.assertApplied()).toThrow(/instead of one/);
    }
  });

  it('refuses a malformed correction or two naming one file', async () => {
    const valid = { reason: 'test', file: AI_INC, sha256: sha256(SHIPPED_AI), lines: SWAP };
    const refused: readonly [object, RegExp][] = [
      [{ ...valid, reason: ' ' }, /reason/],
      [{ ...valid, sha256: 'ABC' }, /sha256/],
      [{ ...valid, lines: [] }, /at least one edit/],
      [{ ...valid, lines: [{ from: 'ż', to: 'z' }] }, /printable-ASCII/],
      [{ ...valid, note: 'x' }, /unknown key "note"/],
    ];
    for (const [correction, why] of refused) {
      await writeCorrection('bad', correction);
      await expect(loadSourceCorrections(dir, mod)).rejects.toThrow(why);
    }
    await writeCorrection('bad', valid);
    await writeCorrection('twin', { ...valid, file: AI_INC.toUpperCase() });
    await expect(loadSourceCorrections(dir, mod)).rejects.toThrow(/bad and twin both name/);
  });

  it('holds none when the directory is gone', async () => {
    const corrections = await loadSourceCorrections(join(temp.path, 'absent'), mod);
    expect(corrections.list).toEqual([]);
    expect(() => corrections.assertApplied()).not.toThrow();
  });

  it('feeds the corrected script file to the map stage', async () => {
    await writeMod(`${MAP_FOLDER}/map.dat`, buildMapDat(1, 1, [2, 2, 2, 2]));
    await writeMod(AI_INC, SHIPPED_AI);
    await writeCorrection('swap', { reason: 'test', file: AI_INC, sha256: sha256(SHIPPED_AI), lines: SWAP });
    const roots = { mod, corrections: await loadSourceCorrections(dir, mod) };

    const [map] = await convertMapDatTree(roots, join(temp.path, 'out'));
    expect(map?.script?.ai.map((row) => [row.player, row.defaultPosition])).toEqual([
      [1, { x: 10, y: 90, range: 55 }],
      [2, { x: 40, y: 2, range: 50 }],
    ]);
    expect(() => roots.corrections.assertApplied()).not.toThrow();
    // Without corrections the stage reads the file as shipped.
    const shipped = await readSourceFile({ mod }, join(mod, AI_INC));
    expect(Buffer.from(shipped).toString('latin1')).toBe(SHIPPED_AI);
  });

  it('parses every committed correction', async () => {
    await expect(loadSourceCorrections(CORRECTIONS_DIR, mod)).resolves.toBeDefined();
  });
});
