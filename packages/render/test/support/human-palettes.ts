import type { HumanPalettes, RandomPaletteRecipe } from '@open-northland/data';
import { emptyHumanPalettes } from '@open-northland/data';
import { HumanPaletteBook } from '../../src/data/palettes/human-palettes.js';
import { HumanPaletteLut } from '../../src/gpu/human-palette-lut.js';

/** The base every synthetic look falls back to: palette index `i` is the grey `(i, i, i)`. */
export const TEST_BASE = 'test_base';
const COLOURS = 256;
const BAND = 16;

function hexByte(value: number): string {
  return value.toString(16).padStart(2, '0');
}

/** A 16-colour ramp of one flat colour, as the lane stores it. */
export function flatRamp(r: number, g: number, b: number): string {
  return `${hexByte(r)}${hexByte(g)}${hexByte(b)}`.repeat(BAND);
}

function greyBase(): string {
  let hex = '';
  for (let i = 0; i < COLOURS; i++) hex += hexByte(i).repeat(3);
  return hex;
}

/** A lane with the grey base, the given ramps and recipes, and player 0's `player_00` / `woman_00`. */
export function syntheticLane(
  ramps: Record<string, string>,
  recipes: readonly RandomPaletteRecipe[],
  extra: Partial<HumanPalettes> = {},
): HumanPalettes {
  return {
    ...emptyHumanPalettes,
    bases: { [TEST_BASE]: greyBase() },
    ramps,
    recipes: [...recipes],
    players: [{ player: 0, male: 'player_00', female: 'woman_00' }],
    ...extra,
  };
}

/** A LUT over a lane whose player 0 recipes paint body band 15 red for men and blue for women. */
export function syntheticHumanLut(
  armorTierByGood: ReadonlyMap<number, number> = new Map(),
  rows?: number,
  soldierJobs: ReadonlySet<number> = new Set(),
): HumanPaletteLut {
  const lane = syntheticLane({ red: flatRamp(255, 0, 0), blue: flatRamp(0, 0, 255) }, [
    { name: 'player_00', patches: [{ band: 15, source: { kind: 'ramp', ramp: 'red' }, weight: 1 }] },
    { name: 'woman_00', patches: [{ band: 15, source: { kind: 'ramp', ramp: 'blue' }, weight: 1 }] },
  ]);
  return new HumanPaletteLut(
    new HumanPaletteBook(lane, TEST_BASE),
    { tierByGood: armorTierByGood, soldierJobs },
    rows,
  );
}
