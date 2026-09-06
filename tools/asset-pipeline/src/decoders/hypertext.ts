import type { HypertextParagraph } from '@open-northland/data';

/**
 * The hypertext the original's mission window renders: `briefings.txt`-style files hold named blocks,
 * and a `.hlt` page splices them in. A `<name:args>` tag switches state: `font` picks headline or
 * body, `block` the alignment, `include` splices a labelled block, `globaljump` links the paragraph
 * that follows to another page; colour, picture, anchor and callback tags are dropped. A `\n` marker
 * breaks the line, and an empty line or segment ends the paragraph. Approximation: a raw line end also
 * breaks the line (the corpus sets schedules one entry per line), pictures are not shown, and an
 * underscore reads as a space (the corpus joins linked headlines with underscores).
 */

const BLOCK_START = /^\[blockstart:([^\]]+)\]\s*$/;
const BLOCK_END = /^\[blockend:([^\]]+)\]\s*$/;
const TAG = /<([a-z]+):([^>]*)>/gi;
const TAG_LINE = /^\s*(?:<[a-z]+:[^>]*>\s*)+$/i;
/** The literal two characters `\n` inside a page: an explicit line or paragraph break. */
const NEWLINE_MARK = /\\n/g;
/** The headline faces the corpus authors (`fonthead16bld.fnt`, `fonthead16bldc2.fnt`). */
const HEADLINE_FONT = /fonthead/i;
/** The `<block:2>` runs are centred (headlines, links); blocks `0` and `1` read left-aligned. */
const CENTRED_BLOCK = '2';
/** A jump target names a page file: `$local$\mythology_00.hlt,0` links the page `mythology_00`. */
const PAGE_FILE = /([^\\/]+)\.hlt\s*$/i;
/** An include that includes itself would otherwise recurse forever. */
const MAX_INCLUDE_DEPTH = 8;

/** The named blocks of a block file, keyed by label; the first block of a repeated label wins. */
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

/** Resolves an `<include:<file>,<label>,…>` tag to the labelled block's text. */
export type IncludeResolver = (file: string, label: string) => string | undefined;

/** The page a `<globaljump:…>` tag opens, by file stem, or null when it names no `.hlt` page. */
export function jumpTarget(args: string): string | null {
  const file = args.split(',')[0] ?? '';
  const match = PAGE_FILE.exec(file);
  return match?.[1] === undefined ? null : match[1].toLowerCase();
}

/** Render one hypertext page into paragraphs. */
export function renderHypertext(text: string, include: IncludeResolver): HypertextParagraph[] {
  const out: HypertextParagraph[] = [];
  const state = {
    style: 'body' as HypertextParagraph['style'],
    centred: false,
    link: null as string | null,
    lines: [] as string[],
  };
  const flush = (): void => {
    if (state.lines.length === 0) return;
    out.push({
      style: state.style,
      text: state.lines.join('\n'),
      ...(state.centred ? { align: 'center' as const } : {}),
      ...(state.link !== null ? { link: state.link } : {}),
    });
    state.lines = [];
    state.link = null;
  };
  const applyTag = (name: string, args: string, depth: number): void => {
    if (name === 'font') {
      const style = HEADLINE_FONT.test(args) ? 'title' : 'body';
      if (style !== state.style) flush();
      state.style = style;
    } else if (name === 'block') {
      const centred = args.trim() === CENTRED_BLOCK;
      if (centred !== state.centred) flush();
      state.centred = centred;
    } else if (name === 'globaljump') {
      flush();
      state.link = jumpTarget(args);
    } else if (name === 'include' && depth < MAX_INCLUDE_DEPTH) {
      const [file, label] = args.split(',').map((part) => part.trim());
      const block = file === undefined || label === undefined ? undefined : include(file, label);
      if (block !== undefined) walk(block, depth + 1);
    }
  };
  const walk = (page: string, depth: number): void => {
    for (const raw of page.split(/\r?\n/)) {
      for (const tag of raw.matchAll(TAG)) applyTag(tag[1]?.toLowerCase() ?? '', tag[2] ?? '', depth);
      if (TAG_LINE.test(raw)) continue;
      for (const segment of raw.replace(TAG, '').split(NEWLINE_MARK)) {
        const line = segment.replaceAll('_', ' ').trimEnd();
        if (line.trim() === '') flush();
        else state.lines.push(line);
      }
    }
  };
  walk(text, 0);
  flush();
  return out;
}
