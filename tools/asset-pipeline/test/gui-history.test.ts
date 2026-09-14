import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { nodeVfs } from '@open-northland/vfs/node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encodePcx } from '../src/decoders/pcx.js';
import { convertGuiHistory } from '../src/stages/gui/history.js';
import { HYPERTEXT_PICTURES_DIR } from '../src/stages/gui/paths.js';
import { rampPalette } from './fixtures/palette.js';
import { type GameOutTemp, makeGameOutTemp } from './support/game-tree.js';

const fs = nodeVfs();

/**
 * The history book stage (`stages/gui/history.ts`): every `.hlt` page of `Data/text/<lang>/hypertext/
 * history/` renders through the block files beside it into one `gui/history/<lang>.json` opened on
 * `index`, with the pictures it names emitted beside it, per language; a language without the start
 * page emits nothing.
 */

const HISTORY_DIR = join('Data', 'text', 'eng', 'hypertext', 'history');

/** CP1250 bytes: the block labels carry `ü` (0xFC), which the decoder must resolve on both sides. */
function cp1250(text: string): Uint8Array {
  return Uint8Array.from(text, (ch) => (ch === 'ü' ? 0xfc : ch.charCodeAt(0)));
}

const BLOCKS = [
  '[blockstart:indexstart]',
  'HISTORY TABLES',
  '[blockend:indexstart]',
  '[blockstart:0_überschrift]',
  'SEVEN_WONDERS',
  '[blockend:0_überschrift]',
  '[blockstart:0_text_0]',
  'A list of seven.',
  '[blockend:0_text_0]',
  '[blockstart:zurücktext]',
  'Back_to_index',
  '[blockend:zurücktext]',
].join('\r\n');

const INDEX = [
  '<anchor:0>',
  '<block:2>',
  '<font:$local$\\fonts\\fonthead16bld.fnt>',
  '<include:$local$\\Mythology.txt,indexstart,1>',
  '\\n',
  '<globaljump:$local$\\mythology_00.hlt,0>',
  '<font:$local$\\fonts\\font12.fnt>',
  '<color:$local$\\palettes\\font_red.pcx>',
  '<include:$local$\\Mythology.txt,0_überschrift,1>',
  '<color:$local$\\palettes\\font_dark.pcx>\\n',
].join('\r\n');

const PAGE = [
  '<block:2>',
  '<font:$local$\\fonts\\fonthead16bld.fnt>',
  '<include:$local$\\Mythology.txt,0_überschrift,1>',
  '\\n',
  '<block:0>',
  '<font:$local$\\fonts\\font12.fnt>',
  '<include:$local$\\Mythology.txt,0_text_0,0>',
  '',
  '<block:2>',
  '<picture:$local$\\graphics\\01_00.pcx>',
  '<color:$local$\\palettes\\font_red.pcx>',
  '<globaljump:$local$\\index.hlt,0>',
  '<include:$local$\\Mythology.txt,zurücktext,1>',
  '\\n',
].join('\r\n');

describe('convertGuiHistory', () => {
  let temp: GameOutTemp;

  beforeEach(async () => {
    temp = await makeGameOutTemp('gui-history');
  });

  afterEach(async () => {
    await temp.cleanup();
  });

  it('renders the pages of the folder into one book per language, linked by page id', async () => {
    await temp.write(join(HISTORY_DIR, 'Mythology.txt'), cp1250(BLOCKS));
    await temp.write(join(HISTORY_DIR, 'Index.hlt'), cp1250(INDEX));
    await temp.write(join(HISTORY_DIR, 'mythology_00.hlt'), cp1250(PAGE));
    await temp.write(
      join(HISTORY_DIR, 'Graphics', '01_00.pcx'),
      encodePcx({ width: 4, height: 3, pixels: new Uint8Array(12).fill(7), palette: rampPalette() }),
    );

    const done = await convertGuiHistory(fs, { mod: temp.game }, temp.out, ['eng', 'pol']);
    expect(done).toEqual([{ lang: 'eng', path: 'gui/history/eng.json', pages: 2 }]);

    const pictures = await readdir(join(temp.out, HYPERTEXT_PICTURES_DIR));
    const book = JSON.parse(await readFile(join(temp.out, 'gui', 'history', 'eng.json'), 'utf8'));
    expect(pictures).toHaveLength(1);
    expect(book).toEqual({
      start: 'index',
      pages: {
        index: [
          { kind: 'text', style: 'title', text: 'HISTORY TABLES', align: 'center' },
          {
            kind: 'text',
            style: 'body',
            text: 'SEVEN WONDERS',
            align: 'center',
            color: 'red',
            link: 'mythology_00',
          },
        ],
        mythology_00: [
          { kind: 'text', style: 'title', text: 'SEVEN WONDERS', align: 'center' },
          { kind: 'text', style: 'body', text: 'A list of seven.' },
          { kind: 'picture', file: pictures[0], width: 4, height: 3, align: 'center' },
          {
            kind: 'text',
            style: 'body',
            text: 'Back to index',
            align: 'center',
            color: 'red',
            link: 'index',
          },
        ],
      },
    });
  });

  it('emits nothing for a folder without the index page', async () => {
    await temp.write(join(HISTORY_DIR, 'mythology_00.hlt'), cp1250('Orphan page'));
    expect(await convertGuiHistory(fs, { mod: temp.game }, temp.out, ['eng'])).toEqual([]);
  });
});
