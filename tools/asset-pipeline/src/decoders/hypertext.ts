import type { BriefingParagraph } from '@open-northland/data';

/**
 * The briefing hypertext the original's mission window renders: `text/<lang>/briefings/briefings.txt`
 * holds named blocks, and a cutscene id names either one of those blocks or a `NNNN.hlt` page that
 * splices them in. A line of `<name:args>` tags switches state: the font (headline vs body) and the
 * include are honoured, the colour, block, picture and callback tags are dropped, and a tag inside a
 * text line is stripped. Approximation: pictures are not shown.
 */

const BLOCK_START = /^\[blockstart:([^\]]+)\]\s*$/;
const BLOCK_END = /^\[blockend:([^\]]+)\]\s*$/;
const TAG = /<([a-z]+):([^>]*)>/gi;
const TAG_LINE = /^\s*(?:<[a-z]+:[^>]*>\s*)+$/i;
/** The headline faces the corpus authors (`fonthead16bld.fnt`, `fonthead16bldc2.fnt`). */
const HEADLINE_FONT = /fonthead/i;
/** An include that includes itself would otherwise recurse forever. */
const MAX_INCLUDE_DEPTH = 8;

/** The named blocks of a `briefings.txt`, keyed by label; the first block of a repeated label wins. */
export function parseBriefingBlocks(text: string): Map<string, string> {
  const blocks = new Map<string, string>();
  let label: string | null = null;
  let lines: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (label === null) {
      const start = BLOCK_START.exec(raw);
      if (start?.[1] !== undefined) {
        label = start[1].trim();
        lines = [];
      }
      continue;
    }
    if (BLOCK_END.test(raw)) {
      if (!blocks.has(label)) blocks.set(label, lines.join('\n'));
      label = null;
      continue;
    }
    lines.push(raw);
  }
  return blocks;
}

/**
 * Render one hypertext page into paragraphs: a blank line ends a paragraph, the lines inside one keep
 * their breaks, and the active font decides the style. `include` resolves an `<include:…,label,…>`
 * tag to the labelled block's text.
 */
export function renderHypertext(
  text: string,
  include: (label: string) => string | undefined,
): BriefingParagraph[] {
  const out: BriefingParagraph[] = [];
  const state = { style: 'body' as BriefingParagraph['style'], lines: [] as string[] };
  const flush = (): void => {
    if (state.lines.length === 0) return;
    out.push({ style: state.style, text: state.lines.join('\n') });
    state.lines = [];
  };
  const walk = (page: string, depth: number): void => {
    for (const raw of page.split(/\r?\n/)) {
      if (TAG_LINE.test(raw)) {
        for (const tag of raw.matchAll(TAG)) {
          const name = tag[1]?.toLowerCase();
          const args = tag[2] ?? '';
          if (name === 'font') {
            const style = HEADLINE_FONT.test(args) ? 'title' : 'body';
            if (style !== state.style) flush();
            state.style = style;
          } else if (name === 'include' && depth < MAX_INCLUDE_DEPTH) {
            const label = args.split(',')[1]?.trim();
            const block = label === undefined ? undefined : include(label);
            if (block !== undefined) walk(block, depth + 1);
          }
        }
        continue;
      }
      const line = raw.replace(TAG, '').trimEnd();
      if (line.trim() === '') {
        flush();
        continue;
      }
      state.lines.push(line);
    }
  };
  walk(text, 0);
  flush();
  return out;
}
