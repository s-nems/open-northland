import type { SpriteLayer } from '@open-northland/render';
import { MONSTER_TRIBES } from '../../catalog/creatures.js';
import { INDEXED_CHARACTER_PALETTE } from '../../catalog/roster.js';
import { diag } from '../../diag/index.js';
import { servedShadowStem } from '../ir/joins.js';
import { loadGalleryLayers } from '../ir/load.js';
import type { ContentIr } from '../ir/rows.js';
import {
  type CharacterSpecId,
  isAnimalBody,
  lookFrom,
  lookStem,
  type TribeLook,
  tribeLooks,
} from '../settler-gfx/index.js';

/** One tribe's look for a character spec, with the served atlas stems its palettes resolve to. */
export interface ResolvedLook extends TribeLook {
  readonly bodyStem: string;
  /** The body's cast-shadow atlas stem. Palette-less, so it is the same set behind every skin the
   *  body loads in. */
  readonly shadowStem?: string;
  readonly headStems: readonly string[];
  /** Whether body and heads load as the recolourable atlas the player-colour LUT is read through. */
  readonly indexed: boolean;
}

/** A loaded body bob set and the head looks that overlay it, by served stem. */
export interface LoadedLook {
  readonly body: SpriteLayer;
  readonly headsByStem: ReadonlyMap<string, SpriteLayer>;
}

/**
 * `look` as the stems to fetch. `palette` overrides each bob set's authored skin - the recolourable atlases
 * the player-colour LUT is read through - and `undefined` keeps each record's own, which is the only skin
 * some bob sets are decoded in (the egyptian soldier ships `egypt_soldier` alone). An animal body has no
 * recolourable atlas, so it keeps its own skin and its heads keep theirs: a look never mixes an indexed
 * layer with a baked one.
 *
 * Known limitation on the LUT path: its rows are composed from `test_human_00` alone, so the civilization
 * looks authored against another palette (the egyptian soldiers) draw in the viking colour table.
 */
function resolveLook(look: TribeLook, palette: string | undefined): ResolvedLook {
  const skin = isAnimalBody(look.bodyBmd) ? undefined : palette;
  const shadowStem = servedShadowStem(look.shadowBmd);
  return {
    ...look,
    bodyStem: lookStem(look.bodyBmd, skin ?? look.bodyPalette),
    ...(shadowStem !== undefined ? { shadowStem } : {}),
    headStems: look.headBmds.map((bmd) => lookStem(bmd, skin ?? look.headPalette)),
    indexed: skin === INDEXED_CHARACTER_PALETTE,
  };
}

/** Every tribe's looks per spec, each resolved by {@link resolveLook}. */
export function resolveLooks(
  ir: ContentIr | null,
  tribes: readonly number[],
  palette: string | undefined,
): Map<number, Map<CharacterSpecId, ResolvedLook[]>> {
  const byTribe = new Map<number, Map<CharacterSpecId, ResolvedLook[]>>();
  for (const tribe of tribes) {
    // The monsters' own skins are their look, so they trade the player colour for them.
    const skin = MONSTER_TRIBES.has(tribe) ? undefined : palette;
    const resolved = new Map<CharacterSpecId, ResolvedLook[]>();
    for (const [specId, chain] of tribeLooks(ir, tribe)) {
      resolved.set(
        specId,
        chain.map((look) => resolveLook(look, skin)),
      );
    }
    byTribe.set(tribe, resolved);
  }
  return byTribe;
}

/** Explicit animal-body jobs, including ones whose numeric job is also a standard soldier class. */
export function resolveAnimalJobLooks(
  ir: ContentIr | null,
  tribes: readonly number[],
): Map<number, Map<number, ResolvedLook[]>> {
  const byTribe = new Map<number, Map<number, ResolvedLook[]>>();
  for (const tribe of tribes) {
    const byJob = new Map<number, ResolvedLook[]>();
    for (const row of ir?.jobGraphics ?? []) {
      if (row.tribe !== tribe) continue;
      const look = lookFrom(row);
      if (!isAnimalBody(look.bodyBmd)) continue;
      const list = byJob.get(row.job) ?? [];
      list.push(resolveLook(look, undefined));
      byJob.set(row.job, list);
    }
    byTribe.set(tribe, byJob);
  }
  return byTribe;
}

/** Load every distinct served body once with the heads that overlay it and its cast-shadow twin; a body
 *  that 404s is left out, so its looks fall back rather than failing the sheet. */
export async function loadLookLayers(looks: readonly ResolvedLook[]): Promise<Map<string, LoadedLook>> {
  // Heads are keyed per body stem, since two looks on one body (civilist and scout) carry different hats.
  const headStemsByBody = new Map<string, Set<string>>();
  // One shadow set per body; first-wins, since the records naming one body agree on its silhouettes.
  const shadowStemByBody = new Map<string, string>();
  for (const look of looks) {
    const set = headStemsByBody.get(look.bodyStem) ?? new Set<string>();
    for (const stem of look.headStems) set.add(stem);
    headStemsByBody.set(look.bodyStem, set);
    if (look.shadowStem !== undefined && !shadowStemByBody.has(look.bodyStem)) {
      shadowStemByBody.set(look.bodyStem, look.shadowStem);
    }
  }
  const loaded = new Map<string, LoadedLook>();
  await Promise.all(
    [...headStemsByBody].map(async ([bodyStem, heads]) => {
      const headStems = [...heads];
      try {
        const layers = await loadGalleryLayers(bodyStem, headStems, shadowStemByBody.get(bodyStem));
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
