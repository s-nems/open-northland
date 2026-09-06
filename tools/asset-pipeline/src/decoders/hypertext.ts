import type {
  HypertextBlock,
  HypertextColor,
  HypertextParagraph,
  HypertextPicture,
} from '@open-northland/data';

/**
 * The hypertext the original's mission window renders: `briefings.txt`-style files hold named blocks
 * and a `.hlt` page splices them in, with `<name:args>` tags switching the state a run is drawn in.
 * Anchor, callback and icon tags are dropped. A `\n` marker breaks the line and an empty line ends the
 * paragraph. Approximation: a raw line end also breaks the line (the corpus sets schedules one entry
 * per line) and an underscore reads as a space (the corpus joins linked headlines with underscores).
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
/** A colour or picture argument names a file: `$local$\palettes\font_red.pcx` names `font_red.pcx`. */
const PCX_FILE = /([^\\/]+\.pcx)\s*$/i;
/** The colour a run takes when its page names no carrier, or one outside the LUT. */
const DEFAULT_COLOR: HypertextColor = 'dark';
/** The font palettes the HUD can draw, by carrier file. A page ships its own copy of the carrier, whose
 *  palette bytes match the HUD's file of that name. */
const COLOR_CARRIERS: Readonly<Record<string, HypertextColor>> = {
  'font_dark.pcx': 'dark',
  'font_red.pcx': 'red',
  'font_white.pcx': 'white',
  'font_dimmed.pcx': 'dimmed',
};
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

/** Resolves a `<picture:…>` tag's lower-cased file name to the emitted picture. */
export type PictureResolver = (name: string) => HypertextPicture | undefined;

export interface HypertextSources {
  readonly include: IncludeResolver;
  /** Without one, pictures are dropped. */
  readonly picture?: PictureResolver;
}

/** The page a `<globaljump:…>` tag opens, by file stem, or null when it names no `.hlt` page. */
export function jumpTarget(args: string): string | null {
  const file = args.split(',')[0] ?? '';
  const match = PAGE_FILE.exec(file);
  return match?.[1] === undefined ? null : match[1].toLowerCase();
}

/** The `.pcx` file a `color` or `picture` argument names, lower-cased and without its directory. */
function pcxName(args: string): string | null {
  const match = PCX_FILE.exec(args);
  return match?.[1] === undefined ? null : match[1].toLowerCase();
}

/** Render one hypertext page into blocks. */
export function renderHypertext(text: string, sources: HypertextSources): HypertextBlock[] {
  const out: HypertextBlock[] = [];
  const state = {
    style: 'body' as HypertextParagraph['style'],
    centred: false,
    color: DEFAULT_COLOR,
    link: null as string | null,
    lines: [] as string[],
  };
  const flush = (): void => {
    if (state.lines.length === 0) return;
    out.push({
      kind: 'text',
      style: state.style,
      text: state.lines.join('\n'),
      ...(state.centred ? { align: 'center' as const } : {}),
      ...(state.color === DEFAULT_COLOR ? {} : { color: state.color }),
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
    } else if (name === 'color') {
      const carrier = pcxName(args);
      const color = (carrier === null ? undefined : COLOR_CARRIERS[carrier]) ?? DEFAULT_COLOR;
      if (color !== state.color) flush();
      state.color = color;
    } else if (name === 'picture') {
      flush();
      const carrier = pcxName(args);
      const picture = carrier === null ? undefined : sources.picture?.(carrier);
      if (picture !== undefined) {
        out.push({ ...picture, ...(state.centred ? { align: 'center' as const } : {}) });
      }
    } else if (name === 'globaljump') {
      flush();
      state.link = jumpTarget(args);
    } else if (name === 'include' && depth < MAX_INCLUDE_DEPTH) {
      const [file, label] = args.split(',').map((part) => part.trim());
      const block = file === undefined || label === undefined ? undefined : sources.include(file, label);
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
