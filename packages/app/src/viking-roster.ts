import { GALLERY_DIRS, clipDirs } from '@vinland/render';
import type { BobSeqRow } from './real-sprites.js';

/**
 * The viking character ROSTER the `?anim` gallery can play — the data behind the character selector and
 * the "heads/looks" montage. Each entry is one composited human: a BODY bob set (its own `[bobseq]`
 * animation set) plus the HEAD looks that overlay it, exactly as the original's `[jobbasegraphics]`
 * pairs `gfxbobmanagerbody` with one or more `gfxbobmanagerhead` slots. The set is transcribed straight
 * from the mod's `types/humanstype/jobgraphics.ini` for viking (`logictribe 1`) jobs — the same
 * body/head files the running game composes, so a look here is a real in-game viking, not a guess.
 *
 * Bodies are named WITHOUT a palette; {@link characterStems} appends the served palette
 * ({@link DEFAULT_CHARACTER_PALETTE}) to form the atlas stem (`cr_hum_body_05` → `cr_hum_body_05.test_human_00`).
 * Skin/hair are palette remaps in the original (`randompalette.ini`), not separate art; our decode bakes
 * one palette, so the roster carries a single look per body today — a per-tone palette axis is the
 * deferred Phase-B follow-up (docs/FIDELITY.md "Character skin/hair variants").
 */
export interface VikingCharacter {
  /** URL id (`?char=`) + selector key, e.g. `warrior`. */
  readonly id: string;
  /** Human label for the selector button, e.g. `Wojownik`. */
  readonly label: string;
  /** The body bob-set stem WITHOUT palette, e.g. `cr_hum_body_05`. */
  readonly bodyBmd: string;
  /** The `bobSequences` key (the `.bmd` imagelib) whose `[bobseq]` this body plays, e.g. `cr_hum_body_05.bmd`. */
  readonly imagelib: string;
  /**
   * The head look bob-set stems WITHOUT palette, in `gfxbobmanagerhead` slot order. **May be empty** for a
   * body-only creature whose head is baked into the body bob (the baby — its `cr_hum_head_22` is an empty
   * atlas), which then draws body-only. The animation view overlays `headBmds[0]` (the default look); the
   * "heads" montage plays the walk with each in turn (the full roster of faces/hats for this body).
   */
  readonly headBmds: readonly string[];
}

/** The served palette every roster body/head decodes with today (the viking base skin). */
export const DEFAULT_CHARACTER_PALETTE = 'test_human_00';

/** The civilist-job (`logicjob 6`) head looks `head_00..03` — the in-game generic man's faces. The
 *  per-job settler binding (`real-sprites.ts`) overlays exactly these; the scout (80..83) and druid
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
  label: 'Cywil',
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
    label: 'Wojownik',
    bodyBmd: 'cr_hum_body_05',
    imagelib: 'cr_hum_body_05.bmd',
    headBmds: WARRIOR_LOOKS,
  },
  {
    id: 'woman',
    label: 'Kobieta',
    bodyBmd: 'cr_hum_body_10',
    imagelib: 'cr_hum_body_10.bmd',
    headBmds: ['cr_hum_head_10'],
  },
  {
    id: 'boy',
    label: 'Chłopiec',
    bodyBmd: 'cr_hum_body_20',
    imagelib: 'cr_hum_body_20.bmd',
    headBmds: ['cr_hum_head_20'],
  },
  {
    id: 'girl',
    label: 'Dziewczynka',
    bodyBmd: 'cr_hum_body_21',
    imagelib: 'cr_hum_body_21.bmd',
    headBmds: ['cr_hum_head_21'],
  },
  {
    id: 'baby',
    label: 'Niemowlę',
    bodyBmd: 'cr_hum_body_22',
    imagelib: 'cr_hum_body_22.bmd',
    // Body-only: `cr_hum_head_22` decodes to an empty atlas (the swaddled baby's head is part of the body
    // bob), so there is no separate head look — the baby draws body-only in every view.
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
 * `_walk` — the baby's `crouch`), then the first row. Pure + total (returns `undefined` only for `[]`).
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
  return m ? `Głowa ${m[1]}` : headBmd;
}
