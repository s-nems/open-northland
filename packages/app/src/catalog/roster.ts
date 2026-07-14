import { clipDirs, GALLERY_DIRS } from '@open-northland/render';
import type { BobSeqRow } from '../content/ir.js';
import { formatMessage, type Messages, messages } from '../i18n/index.js';

/**
 * The viking character roster the `?anim` gallery can play — the data behind the character selector and
 * the "heads/looks" montage. Each entry is one composited human: a body bob set (its own `[bobseq]`
 * animation set) plus the head looks that overlay it, exactly as the original's `[jobbasegraphics]`
 * pairs `gfxbobmanagerbody` with one or more `gfxbobmanagerhead` slots. The set is transcribed straight
 * from the mod's `types/humanstype/jobgraphics.ini` for viking (`logictribe 1`) jobs — the same
 * body/head files the running game composes, so a look here is a real in-game viking, not a guess.
 *
 * Bodies are named without a palette; {@link characterStems} appends the served palette
 * ({@link DEFAULT_CHARACTER_PALETTE}) to form the atlas stem (`cr_hum_body_05` → `cr_hum_body_05.test_human_00`).
 * Skin/hair are palette remaps in the original (`randompalette.ini`), not separate art; our decode bakes
 * one palette, so the roster carries a single look per body today — a per-tone palette axis is the
 * deferred Phase-B follow-up (source basis "Character skin/hair variants").
 */
export interface VikingCharacter {
  /** URL id (`?char=`) + selector key, e.g. `warrior`. */
  readonly id: string;
  /** The body bob-set stem without palette, e.g. `cr_hum_body_05`. */
  readonly bodyBmd: string;
  /** The `bobSequences` key (the `.bmd` imagelib) whose `[bobseq]` this body plays, e.g. `cr_hum_body_05.bmd`. */
  readonly imagelib: string;
  /**
   * The head look bob-set stems without palette, in `gfxbobmanagerhead` slot order. May be empty for a
   * body-only creature whose head is baked into the body bob (the baby — its `cr_hum_head_22` is an empty
   * atlas), which then draws body-only. The animation view overlays `headBmds[0]` (the default look); the
   * "heads" montage plays the walk with each in turn (the full roster of faces/hats for this body).
   */
  readonly headBmds: readonly string[];
}

/** The served palette every roster body/head decodes with today (the viking base skin). */
export const DEFAULT_CHARACTER_PALETTE = 'test_human_00';

/**
 * The stem slug of the indexed (recolourable) character atlas — `<bmd>.indexed`, emitted by the
 * pipeline's player-colour stage alongside the baked ones. Passed to {@link characterStems} to load the
 * atlas the player-colour LUT is read through (see `packages/render` PalettedSprite).
 */
export const INDEXED_CHARACTER_PALETTE = 'indexed';

/**
 * The 16 player (team) colour names, slot order = player id — mirrors the pipeline's `PLAYER_COLORS`
 * (`tools/asset-pipeline/src/decoders/player-palette.ts`): the original's 10 (`playerNN.pcx`) then 6
 * hue-rotated extras. Used only for the gallery's colour-montage captions; the colours themselves live in
 * the LUT texture. Blue is the human player's default.
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

/** How many player colours the LUT + montage cover (up to 16 players). */
export const PLAYER_COLOR_COUNT = PLAYER_COLOR_NAMES.length;

/**
 * One flat `0xRRGGBB` per player id for UI swatches (the minimap's unit dots), slot order =
 * {@link PLAYER_COLOR_NAMES}. A named approximation: the real team colours live only in the pipeline's
 * LUT texture (`player-lut.png`, band-limited palette ramps — no single "the colour" exists there), so
 * this table hand-picks one saturated representative per name — the original 10 by their `playerNN.pcx`
 * hue, the 6 synthetic extras at the pipeline's rotation hues (player-palette.ts).
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

/** The civilist-job (`logicjob 6`) head looks `head_00..03` — the in-game generic man's faces. The
 *  per-job settler binding (`content/settler-gfx.ts`) overlays exactly these; the scout (80..83) and druid
 *  (90..93) looks below stay gallery-only until those jobs exist in a running sim. */
export const CIVILIST_JOB_HEADS = [
  'cr_hum_head_00',
  'cr_hum_head_01',
  'cr_hum_head_02',
  'cr_hum_head_03',
] as const;

/** The civilist looks plus the extra viking male job looks (`head_80..83` scout, `head_90..93` druid)
 *  — all bound to `cr_hum_body_00` for viking jobs 6 / 27 / 30, all covering the generic walk. */
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

/** The default character the gallery opens on — the civilian man, the body the original `?anim` showed. */
export const DEFAULT_CHARACTER: VikingCharacter = {
  id: 'civilian',
  bodyBmd: 'cr_hum_body_00',
  imagelib: 'cr_hum_body_00.bmd',
  headBmds: CIVILIAN_LOOKS,
};

/**
 * The full viking roster, in selector order. Bodies + heads are the viking (`logictribe 1`) records from
 * `types/humanstype/jobgraphics.ini`: civilian man (job 6), warrior (job 31, its own combat `[bobseq]`),
 * woman (job 5), the two children (jobs 4/3), and the baby (job 2). The warrior body carries the whole
 * armed set — broadsword / sword / longbow / shortbow / spear / bare-handed — so selecting it shows the
 * fighting animations the civilian body never had.
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

/** Resolve `?char=<id>` to a roster entry, falling back to {@link DEFAULT_CHARACTER} for an absent/unknown id. */
export function findCharacter(id: string | null): VikingCharacter {
  return VIKING_CHARACTERS.find((c) => c.id === id) ?? DEFAULT_CHARACTER;
}

/** The served atlas stem (`<bmd>.<palette>`) for a roster body/head bmd, e.g. `cr_hum_body_05` → `cr_hum_body_05.test_human_00`. */
export function characterStem(bmd: string, palette: string = DEFAULT_CHARACTER_PALETTE): string {
  return `${bmd}.${palette}`;
}

/** The body + every head atlas stem for a character at a palette, in roster order (`heads[0]` = default look). */
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
 * Pick the sequence to drive the "heads" montage: the plain locomotion cycle, so every look is compared
 * doing the same clean 8-direction walk. Prefers a row whose name ends in `_walk` and is a full ×8 strip
 * (the true walk, not `_walk_agressive` or a carry variant), then the longest ×8 clip (a body with no
 * `_walk` — the baby's `crouch`), then the first row. Pure; returns `undefined` only for `[]`.
 */
export function pickWalkRow(rows: readonly BobSeqRow[]): BobSeqRow | undefined {
  // A ×8 strip is the compass-directional layout the montage's direction selector needs — the same rule
  // `render` names in `clipDirs`/`GALLERY_DIRS`, reused here rather than re-inlining the `% 8`.
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

/** A short human label for a head look bob stem, e.g. `cr_hum_head_08` → `Głowa 08` (the montage cell caption). */
export function headLabel(headBmd: string): string {
  const m = /cr_hum_head_(\d+)/i.exec(headBmd);
  return m ? formatMessage(messages().animation.head, { number: m[1] ?? '' }) : headBmd;
}

/** The localized selector label for a roster entry. */
export function characterLabel(character: VikingCharacter): string {
  const key = character.id as keyof Messages['animation']['roster'];
  return messages().animation.roster[key] ?? character.id;
}
