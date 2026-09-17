import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { atlasFromManifest, type SpriteLayer, type TextureSource } from '@open-northland/render';
import { describe, expect, it } from 'vitest';
import { OPEN_CHEST_ATOMIC } from '../../src/catalog/atomics.js';
import { JOB_DRUID } from '../../src/catalog/jobs.js';
import { INDEXED_CHARACTER_PALETTE } from '../../src/catalog/roster.js';
import { humanSequences, playableSequences } from '../../src/content/ir/joins.js';
import type { ContentIr } from '../../src/content/ir/rows.js';
import {
  ADULT_CHARACTER_BY_JOB,
  CHARACTER_SPEC_ENTRIES,
  type CharacterSpecId,
} from '../../src/content/settler-gfx/index.js';
import type { LoadedLook } from '../../src/content/sprite-sheet/character-looks.js';
import { resolveLooks } from '../../src/content/sprite-sheet/character-looks.js';
import { tribeCharacters } from '../../src/content/sprite-sheet/tribe-characters.js';
import type { WorldTribes } from '../../src/game/world-tribes.js';
import { contentDir, hasRealIr, rawIrUnderTest } from './helpers.js';

/**
 * Every adult look of every civilization plays the chest bend over the REAL decoded content, composed
 * the way the sheet composes it: a wooden chest takes any adult trade and a magical one a druid or hero,
 * so a look without the clip is a settler standing motionless at the chest. Heroes and the other
 * civilizations author no viking clip names; they resolve through their own `[gfxanimatomic]` rows and
 * the `baseJob` chain, which is what this pins.
 */

/** The `TRIBE_TYPE_HUMAN_*` civilizations, viking leading as the base. */
const CIVILIZATIONS: WorldTribes = [1, 2, 3, 4, 7];
const FRANK = 2;

/** The one adult look the source ships no bend for: the frank heroine draws `cr_hum_body_74`, whose
 *  pool holds only its walk, wait and attack, and no frank record binds action 91 to that job. */
const UNBENDABLE: ReadonlySet<`${number}/${CharacterSpecId}`> = new Set([`${FRANK}/hero-bow`]);

const source = {} as TextureSource;

function layerFor(stem: string): SpriteLayer | undefined {
  const path = resolve(contentDir(), 'bobs', `${stem}.atlas.json`);
  if (!existsSync(path)) return undefined;
  return { source, atlas: atlasFromManifest(JSON.parse(readFileSync(path, 'utf8'))) };
}

describe.runIf(hasRealIr())('the chest bend across the civilizations', () => {
  const ir = rawIrUnderTest() as ContentIr;
  if (!existsSync(resolve(contentDir(), 'bobs'))) return;

  const looksByTribe = resolveLooks(ir, CIVILIZATIONS, INDEXED_CHARACTER_PALETTE);
  const layersByBody = new Map<string, LoadedLook>();
  for (const bySpec of looksByTribe.values()) {
    for (const look of [...bySpec.values()].flat()) {
      const body = layerFor(look.bodyStem);
      if (body !== undefined) layersByBody.set(look.bodyStem, { body, headsByStem: new Map() });
    }
  }
  const allSequences = humanSequences(ir);
  const sequencesByBody = new Map(
    [...layersByBody].map(([stem, layers]) => [stem, playableSequences(allSequences, layers.body.atlas)]),
  );
  const tables = new Map(
    CIVILIZATIONS.map((tribe) => [
      tribe,
      tribeCharacters(ir, [], tribe, {
        looks: looksByTribe.get(tribe) ?? new Map(),
        layersByBody,
        sequencesByBody,
      }),
    ]),
  );

  it('binds the chest atomic on every adult look of every civilization', () => {
    for (const [tribe, table] of tables) {
      expect(table, `tribe ${tribe}`).toBeDefined();
      for (const [job, specId] of Object.entries(ADULT_CHARACTER_BY_JOB)) {
        if (UNBENDABLE.has(`${tribe}/${specId}`)) continue;
        const chest = table?.byJob[Number(job)]?.binding.byAtomic?.[OPEN_CHEST_ATOMIC];
        expect(chest, `tribe ${tribe} job ${job} (${specId})`).toBeDefined();
      }
    }
  });

  it('bends the druid, who draws the civilian look, on every civilization', () => {
    for (const [tribe, table] of tables) {
      const druid = table?.byJob[JOB_DRUID] ?? table?.default;
      expect(druid?.binding.byAtomic?.[OPEN_CHEST_ATOMIC], `tribe ${tribe}`).toBeDefined();
    }
  });

  it('keeps the unbendable list exact', () => {
    for (const [tribe, table] of tables) {
      for (const [specId] of CHARACTER_SPEC_ENTRIES) {
        if (!UNBENDABLE.has(`${tribe}/${specId}`)) continue;
        const job = Number(Object.entries(ADULT_CHARACTER_BY_JOB).find(([, id]) => id === specId)?.[0]);
        const look = table?.byJob[job];
        expect(look, `${tribe}/${specId} draws`).toBeDefined();
        expect(look?.binding.byAtomic?.[OPEN_CHEST_ATOMIC], `${tribe}/${specId}`).toBeUndefined();
      }
    }
  });
});
