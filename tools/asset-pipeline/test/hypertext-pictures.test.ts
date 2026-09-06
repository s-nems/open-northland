import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { nodeVfs } from '@open-northland/vfs/node';
import { describe, expect, it } from 'vitest';
import type { IncludeResolver } from '../src/decoders/hypertext.js';
import { encodePcx } from '../src/decoders/pcx.js';
import { decodePng } from '../src/decoders/png.js';
import { HYPERTEXT_PICTURES_DIR } from '../src/stages/gui/paths.js';
import { resolvePagePictures } from '../src/stages/hypertext-pictures.js';
import { rampPalette } from './fixtures/palette.js';
import { makeTempDir } from './support/game-tree.js';

const fs = nodeVfs();

/**
 * The page-picture store (`stages/hypertext-pictures.ts`): the names a page reaches through its
 * includes are emitted once each, under the digest of the source picture, with palette index 0 drawn
 * as nothing; a name that resolves to no file leaves the page without it.
 */

const noIncludes: IncludeResolver = () => undefined;
/** A 3x2 picture whose top row is the colour key and whose bottom row is opaque. */
const KEYED_PCX = encodePcx({
  width: 3,
  height: 2,
  pixels: Uint8Array.from([0, 0, 0, 9, 9, 9]),
  palette: rampPalette(),
});
const page = (...names: string[]): string =>
  names.map((name) => `<picture:$local$\\graphics\\${name}>`).join('\n');

describe('resolvePagePictures', () => {
  it('emits a picture under its source digest, keying index 0 to nothing', async () => {
    const { path: out } = await makeTempDir('hypertext-pictures');
    const { path: src } = await makeTempDir('hypertext-pictures-src');
    await fs.writeFile(join(src, 'keyed.pcx'), KEYED_PCX);

    const picture = await resolvePagePictures(
      fs,
      out,
      async (name) => (name === 'keyed.pcx' ? join(src, 'keyed.pcx') : undefined),
      [page('keyed.pcx')],
      noIncludes,
      'test',
    );

    const digest = createHash('sha256').update(KEYED_PCX).digest('hex').slice(0, 16);
    expect(picture('keyed.pcx')).toEqual({ kind: 'picture', file: `${digest}.png`, width: 3, height: 2 });
    const png = await decodePng(await readFile(join(out, HYPERTEXT_PICTURES_DIR, `${digest}.png`)));
    const alpha = [...png.rgba.filter((_, i) => i % 4 === 3)];
    expect(alpha).toEqual([0, 0, 0, 255, 255, 255]);
  });

  it('writes one file for a picture two pages name and skips one that resolves nowhere', async () => {
    const { path: out } = await makeTempDir('hypertext-pictures-shared');
    const { path: src } = await makeTempDir('hypertext-pictures-shared-src');
    await fs.writeFile(join(src, 'a.pcx'), KEYED_PCX);
    await fs.writeFile(join(src, 'b.pcx'), KEYED_PCX);

    const picture = await resolvePagePictures(
      fs,
      out,
      async (name) => (name === 'gone.pcx' ? undefined : join(src, name)),
      [page('a.pcx', 'gone.pcx'), page('b.pcx')],
      noIncludes,
      'test',
    );

    expect(await readdir(join(out, HYPERTEXT_PICTURES_DIR))).toHaveLength(1);
    expect(picture('a.pcx')).toEqual(picture('b.pcx'));
    expect(picture('gone.pcx')).toBeUndefined();
  });
});
