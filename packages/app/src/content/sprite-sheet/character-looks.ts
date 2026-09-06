import type { SpriteLayer } from '@open-northland/render';
import { diag } from '../../diag/index.js';
import { loadGalleryLayers } from '../ir/load.js';
import type { ContentIr } from '../ir/rows.js';
import { type CharacterSpecId, lookStem, type TribeLook, tribeLooks } from '../settler-gfx/index.js';

/** One tribe's look for a character spec, with the served atlas stems its palettes resolve to. */
export interface ResolvedLook extends TribeLook {
  readonly bodyStem: string;
  readonly headStems: readonly string[];
}

/** A loaded body bob set and the head looks that overlay it, by served stem. */
export interface LoadedLook {
  readonly body: SpriteLayer;
  readonly headsByStem: ReadonlyMap<string, SpriteLayer>;
}

/**
 * Every tribe's looks per spec, as the stems to fetch. `palette` overrides each bob set's authored skin -
 * the recolourable atlases the player-colour LUT is read through - and `undefined` keeps each record's own,
 * which is the only skin some bob sets are decoded in (the egyptian soldier ships `egypt_soldier` alone).
 *
 * Known limitation on the LUT path: its rows are composed from `test_human_00` alone, so the five looks
 * authored against another palette draw in the viking colour table.
 */
export function resolveLooks(
  ir: ContentIr | null,
  tribes: readonly number[],
  palette: string | undefined,
): Map<number, Map<CharacterSpecId, ResolvedLook[]>> {
  const byTribe = new Map<number, Map<CharacterSpecId, ResolvedLook[]>>();
  for (const tribe of tribes) {
    const resolved = new Map<CharacterSpecId, ResolvedLook[]>();
    for (const [specId, chain] of tribeLooks(ir, tribe)) {
      resolved.set(
        specId,
        chain.map((look) => ({
          ...look,
          bodyStem: lookStem(look.bodyBmd, palette ?? look.bodyPalette),
          headStems: look.headBmds.map((bmd) => lookStem(bmd, palette ?? look.headPalette)),
        })),
      );
    }
    byTribe.set(tribe, resolved);
  }
  return byTribe;
}

/** Load every distinct served body once with the heads that overlay it; a body that 404s is left out, so
 *  its looks fall back rather than failing the sheet. */
export async function loadLookLayers(looks: readonly ResolvedLook[]): Promise<Map<string, LoadedLook>> {
  // Heads are keyed per body stem, since two looks on one body (civilist and scout) carry different hats.
  const headStemsByBody = new Map<string, Set<string>>();
  for (const look of looks) {
    const set = headStemsByBody.get(look.bodyStem) ?? new Set<string>();
    for (const stem of look.headStems) set.add(stem);
    headStemsByBody.set(look.bodyStem, set);
  }
  const loaded = new Map<string, LoadedLook>();
  await Promise.all(
    [...headStemsByBody].map(async ([bodyStem, heads]) => {
      const headStems = [...heads];
      try {
        const layers = await loadGalleryLayers(bodyStem, headStems);
        const headsByStem = new Map<string, SpriteLayer>();
        layers.heads.forEach((layer, i) => {
          const stem = headStems[i];
          if (layer !== undefined && stem !== undefined) headsByStem.set(stem, layer);
        });
        loaded.set(bodyStem, { body: layers.body, headsByStem });
      } catch (err) {
        // An optional look must never kill the boot, and a fallback body looks right enough to pass
        // unnoticed, so every failure is reported: an undecoded body is a content gap, anything else a bug.
        diag.warn('content', `character body '${bodyStem}' failed to load - falling back`, err);
      }
    }),
  );
  return loaded;
}
