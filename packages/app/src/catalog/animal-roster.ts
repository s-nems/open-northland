/**
 * The animal body-look table: which baked `cr_ani` recolour draws each animal tribe. Transcribed from
 * the base `Data/engine2d/inis/animals/jobgraphics.ini` adult records (`logicjob 49`, `gfxpalettebody`),
 * keyed by `logictribe`, which is the IR `tribes.typeId`. The baby records are not transcribed.
 */

/** The one body bob set every animal in {@link ANIMAL_PALETTE_BY_TRIBE} plays. */
const ANIMAL_BODY_STEM = 'cr_ani_body_00';

/** The `[bobseq]` imagelib key of {@link ANIMAL_BODY_STEM}. */
export const ANIMAL_BODY_IMAGELIB = `${ANIMAL_BODY_STEM}.bmd`;

/** The served atlas stem of an animal body recolour (the pipeline's `<bmd-stem>.<palette>` naming). */
export const animalBodyStem = (palette: string): string => `${ANIMAL_BODY_STEM}.${palette}`;

/** The served stem of the shared animal cast-shadow atlas (palette-less, one set for every recolour). */
export const ANIMAL_SHADOW_STEM = `${ANIMAL_BODY_STEM}_s.shadow`;

/**
 * Adult animal tribe id to its `gfxpalettebody` recolour, lowercased to the served stem casing (the
 * source writes `LION01`, the pipeline serves `lion01`). A tribe absent here has no `jobgraphics` adult
 * record or no usable body set, and stays unbound. The recolour reuse is the source's own.
 */
export const ANIMAL_PALETTE_BY_TRIBE: ReadonlyMap<number, string> = new Map([
  [8, 'bear01'], // bears
  [9, 'deer01'], // boars
  [10, 'cattle01'], // cattle
  [11, 'deer01'], // stags
  [12, 'deer01'], // deers
  [13, 'house01'], // dogs
  [14, 'deer01'], // goats
  [16, 'house01'], // hares (the baby record also lists deer01 under a duplicated key; adult is house01)
  [17, 'house01'], // rabbits
  [18, 'chicken01'], // evil_hares (the polar bear: bear sequences, white recolour)
  [19, 'house01'], // sheep
  [20, 'wolves01'], // wolves
  [21, 'bear01'], // camels
  [25, 'lion01'], // lions
  [26, 'lion01'], // lionesses
  [27, 'house01'], // sparrows
  [28, 'house01'], // ravens
  [29, 'house01'], // parrots
  [30, 'chicken01'], // chicken
  [31, 'house01'], // ducks
  [34, 'house01'], // bees
  [36, 'house01'], // mosquitos
]);

/**
 * The ambient species' looks, from the same `jobgraphics.ini` adult records: a species the sim never
 * admits whose own body set plays one sequence-less swarm loop. Butterflies (tribe 35) alone.
 */
export const AMBIENT_LOOK_BY_TRIBE: ReadonlyMap<
  number,
  { readonly bodyStem: string; readonly palette: string }
> = new Map([[35, { bodyStem: 'cr_ani_body_01', palette: 'butterfly01' }]]);
