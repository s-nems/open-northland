import { describe, expect, it } from 'vitest';
import { parseBriefingBlocks, renderHypertext } from '../src/decoders/hypertext.js';

/**
 * The briefing hypertext decoder: `briefings.txt` block splitting and the page renderer's tag
 * handling (font switches style, include splices a block, everything else is dropped), with blank
 * lines as paragraph breaks and inner line breaks kept.
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
].join('\r\n');

describe('parseBriefingBlocks', () => {
  it('splits labelled blocks, keeps the first of a repeated label, and drops CR line ends', () => {
    const blocks = parseBriefingBlocks(BLOCKS);
    expect([...blocks.keys()]).toEqual(['500', '00_title', 'newline']);
    expect(blocks.get('00_title')).toBe('PROLOGUE');
    expect(blocks.get('newline')).toBe('');
    expect(blocks.get('500')?.startsWith('<font:')).toBe(true);
  });
});

describe('renderHypertext', () => {
  const blocks = parseBriefingBlocks(BLOCKS);
  const include = (label: string): string | undefined => blocks.get(label);

  it('renders a block: headline font is the title style, blank lines break paragraphs', () => {
    expect(renderHypertext(blocks.get('500') ?? '', include)).toEqual([
      { style: 'title', text: 'SANDSTORM' },
      { style: 'body', text: 'The vikings laid siege.\nAttacks come at:\n0:25\n0:45' },
      { style: 'body', text: 'Good luck' },
    ]);
  });

  it('splices included blocks in the current style and ignores the other tags', () => {
    const page = [
      '<block:2>',
      '<color:$local$\\palettes\\font_dark.pcx>',
      '<font:$local$\\fonts\\fonthead16bld.fnt>',
      '<include:$local$\\briefings.txt,newline,1>',
      '<include:$local$\\briefings.txt,00_title,1>',
      '<font:$local$\\fonts\\font12.fnt>',
      '<include:$local$\\briefings.txt,missing,1>',
      'Body <onscreencallback:1001,200,0>text<usericon:5> here  ',
    ].join('\n');
    expect(renderHypertext(page, include)).toEqual([
      { style: 'title', text: 'PROLOGUE' },
      { style: 'body', text: 'Body text here' },
    ]);
  });

  it('survives a block that includes itself', () => {
    const loop = (label: string): string | undefined =>
      label === 'loop' ? 'again\n<include:$local$\\briefings.txt,loop,1>' : undefined;
    const paragraphs = renderHypertext('<include:x,loop,1>', loop);
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]?.text.split('\n').every((line) => line === 'again')).toBe(true);
  });

  it('renders an empty page to no paragraphs', () => {
    expect(renderHypertext('\n<font:a.fnt>\n\n', include)).toEqual([]);
  });
});
