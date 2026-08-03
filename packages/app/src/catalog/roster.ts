import { clipDirs, GALLERY_DIRS } from '@open-northland/render';
import type { BobSeqRow } from '../content/ir/rows.js';
import { formatMessage, type Messages, messages } from '../i18n/index.js';

/**
 * The viking character roster the `?anim` gallery plays: one body bob set plus the head looks that
 * overlay it, transcribed from the mod's `types/humanstype/jobgraphics.ini` viking (`logictribe 1`) jobs.
 * Body and head stems carry no palette; the served palette is appended to form the atlas stem.
 */
export interface VikingCharacter {
  /** URL id (`?char=`) and selector key, e.g. `warrior`. */
  readonly id: string;
  /** The body bob-set stem without palette, e.g. `cr_hum_body_05`. */
  readonly bodyBmd: string;
  /** The `bobSequences` key holding this body's `[bobseq]` rows, e.g. `cr_hum_body_05.bmd`. */
  readonly imagelib: string;
  /** Head-look stems in `gfxbobmanagerhead` slot order; empty when the head is baked into the body bob. */
  readonly headBmds: readonly string[];
}

/** The served palette every roster body and head decodes with: the viking base skin. */
export const DEFAULT_CHARACTER_PALETTE = 'test_human_00';

/** The palette slug of the indexed (recolourable) atlas the player-colour LUT is read through. */
export const INDEXED_CHARACTER_PALETTE = 'indexed';

/**
 * The 16 player (team) colour names, slot order = player id, mirroring the pipeline's `PLAYER_COLORS`:
 * the original's 10 (`playerNN.pcx`) then 6 hue-rotated extras. Blue is the human player's default.
 */
export const PLAYER_COLOR_NAMES = [
  'blue',
  'red',
  'yellow',
  'cyan',
  'green',
  'purple',
  'grey',
  'orange',
  'neon',
  'black',
  'spring',
  'teal',
  'azure',
  'indigo',
  'magenta',
  'pink',
] as const;

export const PLAYER_COLOR_COUNT = PLAYER_COLOR_NAMES.length;

/**
 * One flat `0xRRGGBB` per player id for UI swatches, slot order = {@link PLAYER_COLOR_NAMES}. An
 * approximation: the real team colours exist only as band-limited ramps in the pipeline's LUT texture,
 * so each name gets one hand-picked representative at its `playerNN.pcx` or rotation hue.
 */
export const PLAYER_SWATCH_COLORS: readonly number[] = [
  0x2f62d8, // blue
  0xd0342c, // red
  0xe6d33e, // yellow
  0x35c4d0, // cyan
  0x2f9e33, // green
  0x8a3fc4, // purple
  0x9a9a9a, // grey
  0xe6862a, // orange
  0x9fe62e, // neon
  0x2c2c2c, // black
  0x21d961, // spring (hue 140)
  0x14d9a8, // teal (hue 168)
  0x2e96e6, // azure (hue 205)
  0x5a46e0, // indigo (hue 250)
  0xd92cb0, // magenta (hue 312)
  0xe64887, // pink (hue 336)
];

/** A player swatch as a CSS hex colour; unknown ids fall to black. */
export function playerSwatchHex(colorId: number): string {
  return `#${(PLAYER_SWATCH_COLORS[colorId] ?? 0).toString(16).padStart(6, '0')}`;
}

/** The civilist-job (`logicjob 6`) head looks `head_00..03`. */
export const CIVILIST_JOB_HEADS = [
  'cr_hum_head_00',
  'cr_hum_head_01',
  'cr_hum_head_02',
  'cr_hum_head_03',
] as const;

/** The scout-job (`logicjob 27`) head looks `head_80..83`, bound to the same generic man body. */
export const SCOUT_JOB_HEADS = [
  'cr_hum_head_80',
  'cr_hum_head_81',
  'cr_hum_head_82',
  'cr_hum_head_83',
] as const;

/** Every look bound to `cr_hum_body_00`: civilist, scout (`head_80..83`) and druid (`head_90..93`). */
const CIVILIAN_LOOKS = [
  ...CIVILIST_JOB_HEADS,
  'cr_hum_head_80',
  'cr_hum_head_81',
  'cr_hum_head_82',
  'cr_hum_head_83',
  'cr_hum_head_90',
  'cr_hum_head_91',
  'cr_hum_head_92',
  'cr_hum_head_93',
] as const;

/** The four soldier looks (`head_05..08`) bound to the warrior body `cr_hum_body_05` (viking job 31). */
const WARRIOR_LOOKS = ['cr_hum_head_05', 'cr_hum_head_06', 'cr_hum_head_07', 'cr_hum_head_08'] as const;

/** The character the gallery opens on. */
export const DEFAULT_CHARACTER: VikingCharacter = {
  id: 'civilian',
  bodyBmd: 'cr_hum_body_00',
  imagelib: 'cr_hum_body_00.bmd',
  headBmds: CIVILIAN_LOOKS,
};

/**
 * The full viking roster in selector order, from the `logictribe 1` records of
 * `types/humanstype/jobgraphics.ini`: civilian man (job 6), warrior (job 31, the only body carrying the
 * armed `[bobseq]` set), woman (job 5), the two children (jobs 4/3) and the baby (job 2).
 */
export const VIKING_CHARACTERS: readonly VikingCharacter[] = [
  DEFAULT_CHARACTER,
  {
    id: 'warrior',
    bodyBmd: 'cr_hum_body_05',
    imagelib: 'cr_hum_body_05.bmd',
    headBmds: WARRIOR_LOOKS,
  },
  {
    id: 'woman',
    bodyBmd: 'cr_hum_body_10',
    imagelib: 'cr_hum_body_10.bmd',
    headBmds: ['cr_hum_head_10'],
  },
  {
    id: 'boy',
    bodyBmd: 'cr_hum_body_20',
    imagelib: 'cr_hum_body_20.bmd',
    headBmds: ['cr_hum_head_20'],
  },
  {
    id: 'girl',
    bodyBmd: 'cr_hum_body_21',
    imagelib: 'cr_hum_body_21.bmd',
    headBmds: ['cr_hum_head_21'],
  },
  {
    id: 'baby',
    bodyBmd: 'cr_hum_body_22',
    imagelib: 'cr_hum_body_22.bmd',
    // Body-only: `cr_hum_head_22` is an empty atlas (the swaddled baby's head is baked into the body bob).
    headBmds: [],
  },
];

export function findCharacter(id: string | null): VikingCharacter {
  return VIKING_CHARACTERS.find((c) => c.id === id) ?? DEFAULT_CHARACTER;
}

/** The served atlas stem for a roster body/head bmd: `<bmd>.<palette>`. */
export function characterStem(bmd: string, palette: string = DEFAULT_CHARACTER_PALETTE): string {
  return `${bmd}.${palette}`;
}

/** The body and head atlas stems for a character at a palette; `headStems[0]` is the default look. */
export function characterStems(
  char: VikingCharacter,
  palette: string = DEFAULT_CHARACTER_PALETTE,
): { readonly bodyStem: string; readonly headStems: string[] } {
  return {
    bodyStem: characterStem(char.bodyBmd, palette),
    headStems: char.headBmds.map((h) => characterStem(h, palette)),
  };
}

/**
 * The row the "heads" montage plays, so every look is compared doing the same clip: the plain `_walk`
 * ×8 strip when a body has one, else its longest ×8 clip, else the first row.
 */
export function pickWalkRow(rows: readonly BobSeqRow[]): BobSeqRow | undefined {
  const eightDir = (r: BobSeqRow): boolean => clipDirs(r.length) === GALLERY_DIRS;
  const plainWalk = rows.find((r) => /_walk$/i.test(r.name) && eightDir(r));
  if (plainWalk !== undefined) return plainWalk;
  const longestEightDir = rows
    .filter(eightDir)
    .reduce<BobSeqRow | undefined>(
      (best, r) => (best === undefined || r.length > best.length ? r : best),
      undefined,
    );
  return longestEightDir ?? rows[0];
}

/** The montage caption for a head look stem, e.g. `cr_hum_head_08` → `Głowa 08`. */
export function headLabel(headBmd: string): string {
  const m = /cr_hum_head_(\d+)/i.exec(headBmd);
  return m ? formatMessage(messages().animation.head, { number: m[1] ?? '' }) : headBmd;
}

/** The localized selector label for a roster entry. */
export function characterLabel(character: VikingCharacter): string {
  const key = character.id as keyof Messages['animation']['roster'];
  return messages().animation.roster[key] ?? character.id;
}
