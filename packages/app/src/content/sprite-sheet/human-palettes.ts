import { HumanPalettes } from '@open-northland/data';
import { type CharacterPalette, HumanPaletteBook, HumanPaletteLut } from '@open-northland/render';
import type { ContentIr } from '../ir/rows.js';
import { DEFAULT_PALETTE, lookFrom } from '../settler-gfx/index.js';

/** The IR's `humanPalettes` lane made ready to compose, or undefined when the lane is absent, invalid or
 *  carries no player recipes. */
export function humanPaletteBook(ir: ContentIr | null): HumanPaletteBook | undefined {
  const lane = HumanPalettes.safeParse(ir?.humanPalettes);
  if (!lane.success) return undefined;
  const book = new HumanPaletteBook(lane.data, DEFAULT_PALETTE, parentJobs(ir));
  return book.composable ? book : undefined;
}

/** Each job's `jobtypes.ini` base job, where it has one. */
function parentJobs(ir: ContentIr | null): ReadonlyMap<number, number> {
  const parents = new Map<number, number>();
  for (const job of ir?.jobs ?? []) {
    if (typeof job.typeId === 'number' && typeof job.baseJob === 'number' && job.baseJob > 0) {
      parents.set(job.typeId, job.baseJob);
    }
  }
  return parents;
}

/** The human palette LUT the world draws every indexed human through, over {@link humanPaletteBook}. */
export function humanPaletteLut(ir: ContentIr | null): HumanPaletteLut | undefined {
  const book = humanPaletteBook(ir);
  return book === undefined ? undefined : new HumanPaletteLut(book, armorTiersByGood(ir));
}

/** The palettes of `tribe`'s first `[jobbasegraphics]` look drawn on `bodyBmd`, for a viewer that shows a
 *  body without a job; the fallback base alone when no record names it. */
export function bodyCharacterPalette(ir: ContentIr | null, tribe: number, bodyBmd: string): CharacterPalette {
  for (const row of ir?.jobGraphics ?? []) {
    if (row.tribe !== tribe) continue;
    const look = lookFrom(row);
    if (look.bodyBmd === bodyBmd) return look.palette;
  }
  return { body: DEFAULT_PALETTE, head: DEFAULT_PALETTE, random: [] };
}

/** The worn-armor recolor join: armor `goodType` → its `typeId` (the `TArmorType` tier, the index of its
 *  `human_armor_NNN` recipe). Empty for synthetic content (no `armor` lane), which adds no armor recipe. */
function armorTiersByGood(ir: ContentIr | null): ReadonlyMap<number, number> {
  const byGood = new Map<number, number>();
  for (const record of ir?.armor ?? []) {
    if (typeof record.goodType !== 'number' || typeof record.typeId !== 'number') continue;
    if (!byGood.has(record.goodType)) byGood.set(record.goodType, record.typeId);
  }
  return byGood;
}
