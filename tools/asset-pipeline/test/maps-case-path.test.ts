import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findPathCaseInsensitive } from '../src/stages/maps/case-path.js';
import { makeTempDir } from './support/game-tree.js';

/**
 * Portability guard for the case-insensitive map-folder resolution (map folders ship `Text/`/`TEXT/`/
 * `Pol/`/`Strings.ini` in mixed case; a case-sensitive Linux CI must still find them). These build a
 * REAL temp tree and resolve against it. (The same-name-differing-only-in-case tie-break can't be
 * exercised on a case-insensitive host FS, so it is left to the source's documented lexicographic rule.)
 */
describe('findPathCaseInsensitive', () => {
  let root = '';

  afterEach(() => {
    // mkdtemp dirs live under the OS tmp dir; the OS reclaims them — no explicit rm needed per test.
    root = '';
  });

  async function tmpTree(): Promise<string> {
    root = (await makeTempDir('case-path')).path;
    return root;
  }

  it('resolves an exactly-cased path', async () => {
    const dir = await tmpTree();
    await mkdir(join(dir, 'text'));
    await writeFile(join(dir, 'text', 'strings.ini'), 'x');
    expect(await findPathCaseInsensitive(dir, ['text', 'strings.ini'])).toBe(
      join(dir, 'text', 'strings.ini'),
    );
  });

  it('matches each segment case-insensitively against the on-disk casing', async () => {
    const dir = await tmpTree();
    await mkdir(join(dir, 'Text'));
    await writeFile(join(dir, 'Text', 'Strings.ini'), 'x');
    // Ask in lower-case; the on-disk entries are capitalised — the result carries the real casing.
    expect(await findPathCaseInsensitive(dir, ['text', 'strings.ini'])).toBe(
      join(dir, 'Text', 'Strings.ini'),
    );
  });

  it('resolves a multi-segment nested path', async () => {
    const dir = await tmpTree();
    await mkdir(join(dir, 'MISSION', 'POL'), { recursive: true });
    expect(await findPathCaseInsensitive(dir, ['mission', 'pol'])).toBe(join(dir, 'MISSION', 'POL'));
  });

  it('returns null when a segment is absent', async () => {
    const dir = await tmpTree();
    await mkdir(join(dir, 'text'));
    expect(await findPathCaseInsensitive(dir, ['text', 'missing.ini'])).toBeNull();
  });

  it('returns null when the root directory does not exist', async () => {
    const dir = await tmpTree();
    expect(await findPathCaseInsensitive(join(dir, 'nope'), ['anything'])).toBeNull();
  });

  it('returns the directory itself for an empty segment list', async () => {
    const dir = await tmpTree();
    expect(await findPathCaseInsensitive(dir, [])).toBe(dir);
  });
});
