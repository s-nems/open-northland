import type {
  HypertextAlign,
  HypertextBlock,
  HypertextColor,
  HypertextParagraph,
  HypertextPicture,
  HypertextUserIcon,
} from '@open-northland/data';

/**
 * The hypertext the original's mission window and history book render: `briefings.txt`-style files
 * hold named blocks and a `.hlt` page splices them in, with `<name:args>` tags switching the state the
 * words after them draw in. The engine lays words out on lines (`an original routine`):
 * a line ends at a `\n` marker, and inside an include whose third argument is non-zero also at every
 * line end of the block; elsewhere a line end is plain whitespace. A line end on a line that holds
 * nothing yet leaves an empty line. A `<globaljump:…>` links the one word after it. Anchor and callback
 * tags are dropped. Approximations: a line whose words change style, colour or link breaks there, words
 * and icons sharing a line stack as rows of their own, and an underscore reads as a space (the corpus
 * joins linked headlines with underscores into one word).
 */

const BLOCK_START = /^\[blockstart:([^\]]+)\]\s*$/;
const BLOCK_END = /^\[blockend:[^\]]+\]\s*$/;
/** A tag, a `\n` marker, whitespace, or a word running up to the next of those. A `<` that opens no
 *  tag stays part of a word. */
const TOKEN = /<([a-z]+)(?::([^>]*))?>|\\n|\s+|(?:[^\s<\\]|\\(?!n))+|</gi;
const NEWLINE_MARK = '\\n';
const WHITESPACE = /^\s+$/;
/** The headline faces the corpus authors (`fonthead16bld.fnt`, `fonthead16bldc2.fnt`). */
const HEADLINE_FONT = /fonthead/i;
/** `<block:N>` values, the engine's line alignments. */
const BLOCK_ALIGN: Readonly<Record<number, HypertextAlign | undefined>> = {
  1: 'justify',
  2: 'center',
  3: 'right',
};
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
/** The integers a `<usericon:…>` hands the window's bitmap callback. */
const USER_ICON_ARGS = 4;
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

/** A `<usericon:…>` argument list: comma-separated integers, zero from the first missing one on. */
function userIcon(args: string): HypertextUserIcon {
  const values: number[] = [];
  for (const part of args.split(',').slice(0, USER_ICON_ARGS)) {
    if (!/^\d/.test(part)) break;
    values.push(Number.parseInt(part, 10));
  }
  while (values.length < USER_ICON_ARGS) values.push(0);
  const [kind = 0, a = 0, b = 0, c = 0] = values;
  return [kind, a, b, c];
}

interface RunAttrs {
  readonly style: HypertextParagraph['style'];
  readonly color: HypertextColor;
  readonly link: string | null;
}

type LinePiece =
  | { readonly kind: 'words'; readonly attrs: RunAttrs; readonly words: string[] }
  | { readonly kind: 'icon'; readonly icon: HypertextUserIcon };

function sameAttrs(a: RunAttrs, b: RunAttrs): boolean {
  return a.style === b.style && a.color === b.color && a.link === b.link;
}

/** Render one hypertext page into blocks. */
export function renderHypertext(text: string, sources: HypertextSources): HypertextBlock[] {
  const out: HypertextBlock[] = [];
  let attrs: RunAttrs = { style: 'body', color: DEFAULT_COLOR, link: null };
  let align: HypertextAlign | undefined;
  /** The target of the last `<globaljump:…>`, until the next word or icon takes it. */
  let jump: string | null = null;
  let line: LinePiece[] = [];
  let run: { attrs: RunAttrs; align: HypertextAlign | undefined; lines: string[] } | null = null;

  const flushRun = (): void => {
    if (run === null) return;
    const { style, color, link } = run.attrs;
    out.push({
      kind: 'text',
      style,
      text: run.lines.join('\n'),
      ...(run.align !== undefined ? { align: run.align } : {}),
      ...(color === DEFAULT_COLOR ? {} : { color }),
      ...(link !== null ? { link } : {}),
    });
    run = null;
  };
  const textLine = (lineAttrs: RunAttrs, words: readonly string[]): void => {
    if (run !== null && sameAttrs(run.attrs, lineAttrs) && run.align === align) {
      run.lines.push(words.join(' '));
      return;
    }
    flushRun();
    run = { attrs: lineAttrs, align, lines: [words.join(' ')] };
  };
  const iconRow = (icons: HypertextUserIcon[]): void => {
    flushRun();
    out.push({ kind: 'icons', icons, ...(align !== undefined ? { align } : {}) });
  };
  /** Ends the current line: its words join the open run, its icons form a row. */
  const endLine = (): void => {
    let icons: HypertextUserIcon[] = [];
    for (const piece of line) {
      if (piece.kind === 'icon') {
        icons.push(piece.icon);
        continue;
      }
      if (icons.length > 0) iconRow(icons);
      icons = [];
      textLine(piece.attrs, piece.words);
    }
    if (icons.length > 0) iconRow(icons);
    line = [];
  };
  const newline = (): void => {
    if (line.length > 0) {
      endLine();
      return;
    }
    flushRun();
    const last = out.at(-1);
    if (last?.kind === 'blank') out[out.length - 1] = { kind: 'blank', lines: last.lines + 1 };
    else out.push({ kind: 'blank', lines: 1 });
  };
  const word = (w: string): void => {
    const wordAttrs = jump === null ? attrs : { ...attrs, link: jump };
    jump = null;
    const last = line.at(-1);
    if (last?.kind === 'words' && sameAttrs(last.attrs, wordAttrs)) last.words.push(w);
    else line.push({ kind: 'words', attrs: wordAttrs, words: [w] });
  };

  const applyTag = (name: string, args: string, depth: number): void => {
    if (name === 'font') {
      attrs = { ...attrs, style: HEADLINE_FONT.test(args) ? 'title' : 'body' };
    } else if (name === 'block') {
      align = BLOCK_ALIGN[Number.parseInt(args, 10)];
    } else if (name === 'color') {
      const carrier = pcxName(args);
      attrs = { ...attrs, color: (carrier === null ? undefined : COLOR_CARRIERS[carrier]) ?? DEFAULT_COLOR };
    } else if (name === 'picture') {
      const carrier = pcxName(args);
      const picture = carrier === null ? undefined : sources.picture?.(carrier);
      if (picture === undefined) return;
      // The engine centres a picture on a line of its own, whatever the block alignment.
      if (line.length > 0) endLine();
      flushRun();
      out.push(picture);
    } else if (name === 'usericon') {
      jump = null;
      line.push({ kind: 'icon', icon: userIcon(args) });
    } else if (name === 'globaljump') {
      jump = jumpTarget(args);
    } else if (name === 'include' && depth < MAX_INCLUDE_DEPTH) {
      const [file, label, breaks] = args.split(',').map((part) => part.trim());
      const block = file === undefined || label === undefined ? undefined : sources.include(file, label);
      if (block === undefined) return;
      const flag = Number.parseInt(breaks ?? '', 10);
      const lineEndsBreak = Number.isInteger(flag) && flag !== 0;
      for (const blockLine of block.split('\n')) {
        walk(blockLine, depth + 1);
        if (lineEndsBreak) newline();
      }
    }
  };
  const walk = (page: string, depth: number): void => {
    for (const token of page.matchAll(TOKEN)) {
      const [raw, tag, args] = token;
      if (tag !== undefined) applyTag(tag.toLowerCase(), args ?? '', depth);
      else if (raw === NEWLINE_MARK) newline();
      else if (!WHITESPACE.test(raw)) {
        const w = raw.replaceAll('_', ' ').trim();
        if (w !== '') word(w);
      }
    }
  };
  walk(text, 0);
  if (line.length > 0) endLine();
  flushRun();
  while (out.at(-1)?.kind === 'blank') out.pop();
  return out;
}
