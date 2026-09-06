import { describe, expect, it } from 'vitest';
import {
  type IncludeResolver,
  jumpTarget,
  parseBriefingBlocks,
  renderHypertext,
} from '../src/decoders/hypertext.js';

/**
 * The hypertext decoder: block splitting and the page renderer's tag handling (font switches style,
 * block sets the alignment, color the text colour, include splices a block, picture emits a picture
 * block, globaljump links the next paragraph, everything else is dropped), with blank lines and `\n`
 * markers as paragraph breaks and inner line breaks kept.
 */

const BLOCKS = [
  '[blockstart:500]',
  '<font:$local$\\fonts\\fonthead16bld.fnt>',
  'SANDSTORM',
  '<font:$local$\\fonts\\font12.fnt>',
  '',
  'The vikings laid siege.',
  'Attacks come at:',
  '0:25',
  '0:45',
  '',
  '<picture:$local$\\graphics\\map.pcx>',
  'Good luck',
  '[blockend:500]',
  '[blockstart:500]',
  'a duplicate that must lose',
  '[blockend:500]',
  '[blockstart:00_title]',
  'PROLOGUE',
  '[blockend:00_title]',
  '[blockstart:newline]',
  '',
  '[blockend:newline]',
  '[blockstart:0_heading]',
  'SEVEN_WONDERS ',
  '[blockend:0_heading]',
  '[blockstart:back]',
  'Back_to_index',
  '[blockend:back]',
].join('\r\n');

describe('parseBriefingBlocks', () => {
  it('splits labelled blocks, keeps the first of a repeated label, and drops CR line ends', () => {
    const blocks = parseBriefingBlocks(BLOCKS);
    expect([...blocks.keys()]).toEqual(['500', '00_title', 'newline', '0_heading', 'back']);
    expect(blocks.get('00_title')).toBe('PROLOGUE');
    expect(blocks.get('newline')).toBe('');
    expect(blocks.get('500')?.startsWith('<font:')).toBe(true);
  });
});

describe('jumpTarget', () => {
  it('names the page by its file stem, lower-cased, and rejects a non-page target', () => {
    expect(jumpTarget('$local$\\Mythology_00.hlt,0')).toBe('mythology_00');
    expect(jumpTarget('$local$\\index.hlt')).toBe('index');
    expect(jumpTarget('$local$\\graphics\\map.pcx,0')).toBeNull();
  });
});

describe('renderHypertext', () => {
  const blocks = parseBriefingBlocks(BLOCKS);
  const include: IncludeResolver = (file, label) =>
    file.endsWith('briefings.txt') ? blocks.get(label) : undefined;

  it('renders a block: headline font is the title style, blank lines break paragraphs', () => {
    expect(renderHypertext(blocks.get('500') ?? '', { include })).toEqual([
      { kind: 'text', style: 'title', text: 'SANDSTORM' },
      { kind: 'text', style: 'body', text: 'The vikings laid siege.\nAttacks come at:\n0:25\n0:45' },
      { kind: 'text', style: 'body', text: 'Good luck' },
    ]);
  });

  it('splices included blocks in the current style, centres block 2, and ignores the other tags', () => {
    const page = [
      '<anchor:0>',
      '<block:2>',
      '<color:$local$\\palettes\\font_dark.pcx>',
      '<font:$local$\\fonts\\fonthead16bld.fnt>',
      '<include:$local$\\briefings.txt,newline,1>',
      '<include:$local$\\briefings.txt,00_title,1>',
      '<block:1>',
      '<font:$local$\\fonts\\font12.fnt>',
      '<include:$local$\\briefings.txt,missing,1>',
      '<include:$local$\\other.txt,00_title,1>',
      'Body <onscreencallback:1001,200,0>text<usericon:5> here  ',
    ].join('\n');
    expect(renderHypertext(page, { include })).toEqual([
      { kind: 'text', style: 'title', text: 'PROLOGUE', align: 'center' },
      { kind: 'text', style: 'body', text: 'Body text here' },
    ]);
  });

  it('breaks lines on \\n markers and paragraphs on empty ones, links after a globaljump, reads _ as a space', () => {
    const page = [
      '<block:2>',
      '<font:$local$\\fonts\\fonthead16bld.fnt>',
      '<include:$local$\\briefings.txt,0_heading,1>',
      '\\n',
      '<block:0>',
      '<font:$local$\\fonts\\font12.fnt>',
      'First line\\nsecond line',
      '\\n',
      '\\n',
      '<block:2>',
      '<color:$local$\\palettes\\font_red.pcx>',
      '<globaljump:$local$\\index.hlt,0>',
      '<include:$local$\\briefings.txt,back,1>',
      '<color:$local$\\palettes\\font_dark.pcx>\\n',
      'Not a link',
    ].join('\n');
    expect(renderHypertext(page, { include })).toEqual([
      { kind: 'text', style: 'title', text: 'SEVEN WONDERS', align: 'center' },
      { kind: 'text', style: 'body', text: 'First line\nsecond line' },
      { kind: 'text', style: 'body', text: 'Back to index', align: 'center', color: 'red', link: 'index' },
      { kind: 'text', style: 'body', text: 'Not a link', align: 'center' },
    ]);
  });

  it('survives a block that includes itself', () => {
    const loop: IncludeResolver = (_file, label) =>
      label === 'loop' ? 'again\n<include:$local$\\briefings.txt,loop,1>' : undefined;
    const blocksOut = renderHypertext('<include:x,loop,1>', { include: loop });
    const first = blocksOut[0];
    expect(blocksOut).toHaveLength(1);
    expect(first?.kind === 'text' && first.text.split('\n').every((line) => line === 'again')).toBe(true);
  });

  it('emits a resolved picture as its own block and drops one the caller cannot resolve', () => {
    const picture = (name: string) =>
      name === 'map.pcx'
        ? { kind: 'picture' as const, file: 'ab12.png', width: 320, height: 200 }
        : undefined;
    expect(renderHypertext(blocks.get('500') ?? '', { include, picture })).toEqual([
      { kind: 'text', style: 'title', text: 'SANDSTORM' },
      { kind: 'text', style: 'body', text: 'The vikings laid siege.\nAttacks come at:\n0:25\n0:45' },
      { kind: 'picture', file: 'ab12.png', width: 320, height: 200 },
      { kind: 'text', style: 'body', text: 'Good luck' },
    ]);
    expect(renderHypertext('<picture:$local$\\graphics\\gone.pcx>', { include, picture })).toEqual([]);
  });

  it('takes the colour from the page palette and leaves an unknown carrier at the body colour', () => {
    const page = [
      '<color:$local$\\palettes\\font_red.pcx>',
      'Warning',
      '',
      '<color:$local$\\palettes\\font_blue.pcx>',
      'Plain again',
    ].join('\n');
    expect(renderHypertext(page, { include })).toEqual([
      { kind: 'text', style: 'body', text: 'Warning', color: 'red' },
      { kind: 'text', style: 'body', text: 'Plain again' },
    ]);
  });

  it('renders an empty page to no paragraphs', () => {
    expect(renderHypertext('\n<font:a.fnt>\n\n\\n\n', { include })).toEqual([]);
  });
});
