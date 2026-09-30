import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type { ContentSet } from '@open-northland/data';
import { atlasFromManifest, type SpriteLayer, type TextureSource } from '@open-northland/render';
import { ANIMAL_BODY_IMAGELIB } from '../../src/catalog/animal-roster.js';
import { INDEXED_CHARACTER_PALETTE } from '../../src/catalog/roster.js';
import {
  bodySequences,
  humanSequences,
  playableSequences,
  sequencesFor,
} from '../../src/content/ir/joins.js';
import type { ContentIr } from '../../src/content/ir/rows.js';
import { loadRealContent, mergeRealContent, type RealContentMerge } from '../../src/content/real-content.js';
import { isAnimalBody } from '../../src/content/settler-gfx/index.js';
import { resolveAnimalJobLooks, resolveLooks } from '../../src/content/sprite-sheet/character-looks.js';
import { tribeAtomicPrograms, tribeCharacters } from '../../src/content/sprite-sheet/tribe-characters.js';
import type { WorldTribes } from '../../src/game/world-tribes.js';
import { checkoutRoot } from '../support/checkout-root.js';

/**
 * Shared plumbing for the manual real-content suite (`npm run test:content` / `test:pipeline` -
 * docs/TESTING.md "Real-content test modes"). The suite validates whatever content directory
 * `ON_CONTENT_DIR` points at (a fresh pipeline output under `test:pipeline`), defaulting to the
 * checkout's gitignored `content/`; every describe gates on {@link hasRealIr} so plain `npm test`
 * still skips cleanly on a bare checkout.
 */

/** The content directory under test: `ON_CONTENT_DIR` (absolute, or relative to the repo root) when set,
 *  else `content/`. Resolution rules mirror `scripts/test-content.mjs` - keep them in step. */
export function contentDir(): string {
  const override = process.env.ON_CONTENT_DIR;
  if (override === undefined || override === '') return resolve(checkoutRoot(), 'content');
  return isAbsolute(override) ? override : resolve(checkoutRoot(), override);
}

export function irPath(): string {
  return resolve(contentDir(), 'ir.json');
}

/** `describe.runIf` gate: the whole suite skips on a checkout without generated content. */
export function hasRealIr(): boolean {
  return existsSync(irPath());
}

/** The raw IR plus its sim-ready merge, loaded once per test run. */
export interface RealContentUnderTest {
  readonly real: ContentSet;
  readonly merge: RealContentMerge;
}

let rawIr: unknown;

/**
 * The raw parsed ir.json under test - for assertions over graphics lanes (`bobSequences`,
 * `buildingBobs`, `landscapeGfx`) that the sim's `ContentSet` does not carry. Callers gate on
 * {@link hasRealIr} and cast to a narrow local interface; a present-but-malformed IR throws loudly
 * (this suite never skips over broken content). Memoized like {@link loadContentUnderTest}.
 */
export function rawIrUnderTest(): unknown {
  rawIr ??= JSON.parse(readFileSync(irPath(), 'utf8'));
  return rawIr;
}

let underTest: Promise<RealContentUnderTest> | null = null;

/**
 * Parse the IR under test through the app's real boundary - `loadRealContent` (schema +
 * cross-reference validation) then `mergeRealContent` (clean-room balance overlays) - exactly the
 * path the browser entries run, so a break here is a break the game would hit. Memoized: the
 * multi-MB IR parses once for the whole suite.
 */
/** A `fetch` that serves the IR under test off disk for the one URL the loader requests. */
export const serveIrFetch: typeof fetch = (input) =>
  Promise.resolve(
    String(input) === '/ir.json'
      ? new Response(readFileSync(irPath(), 'utf8'))
      : new Response(null, { status: 404 }),
  );

export function loadContentUnderTest(): Promise<RealContentUnderTest> {
  underTest ??= (async () => {
    const real = await loadRealContent(serveIrFetch);
    if (real === null) throw new Error(`no ir.json at ${irPath()} - run via npm run test:content`);
    return { real, merge: mergeRealContent(real) };
  })();
  return underTest;
}

/** A tribe's character table as {@link characterTablesUnderTest} resolves it. */
export type CharacterTableUnderTest = ReturnType<typeof tribeCharacters>;

/**
 * The character tables of `civilizations` resolved over the generated body and head atlases, the way the sprite
 * sheet builds them, so a test can read what clip a look binds to an action. Null on a checkout whose
 * content has no rendered bobs.
 */
export function characterTablesUnderTest(
  civilizations: WorldTribes,
): Map<number, CharacterTableUnderTest> | null {
  if (!existsSync(resolve(contentDir(), 'bobs'))) return null;
  const ir = rawIrUnderTest() as ContentIr;
  const source = {} as TextureSource;
  const layerFor = (stem: string): SpriteLayer | undefined => {
    const path = resolve(contentDir(), 'bobs', `${stem}.atlas.json`);
    if (!existsSync(path)) return undefined;
    return { source, atlas: atlasFromManifest(JSON.parse(readFileSync(path, 'utf8'))) };
  };
  const looksByTribe = resolveLooks(ir, civilizations, INDEXED_CHARACTER_PALETTE);
  const animalJobsByTribe = resolveAnimalJobLooks(ir, civilizations);
  const layersByBody = new Map<string, { body: SpriteLayer; headsByStem: Map<string, SpriteLayer> }>();
  const bmdByStem = new Map<string, string>();
  for (const bySpec of looksByTribe.values()) {
    for (const look of [...bySpec.values()].flat()) {
      bmdByStem.set(look.bodyStem, look.bodyBmd);
      let loaded = layersByBody.get(look.bodyStem);
      if (loaded === undefined) {
        const body = layerFor(look.bodyStem);
        if (body === undefined) continue;
        loaded = { body, headsByStem: new Map() };
        layersByBody.set(look.bodyStem, loaded);
      }
      for (const stem of look.headStems) {
        const head = loaded.headsByStem.get(stem) ?? layerFor(stem);
        if (head !== undefined) loaded.headsByStem.set(stem, head);
      }
    }
  }
  for (const byJob of animalJobsByTribe.values()) {
    for (const look of [...byJob.values()].flat()) {
      const body = layerFor(look.bodyStem);
      if (body !== undefined) layersByBody.set(look.bodyStem, { body, headsByStem: new Map() });
    }
  }
  const allSequences = humanSequences(ir);
  const animalSequences = sequencesFor(ir, ANIMAL_BODY_IMAGELIB);
  // The IR's own goods stand in for the running set's, so the per-good carry gaits bind as they would.
  const goods = (ir.goods ?? []).map(({ typeId, id }) => ({ typeId, id }));
  const sequencesByBody = new Map(
    [...layersByBody].map(([stem, layers]) => [
      stem,
      isAnimalBody(stem)
        ? playableSequences(animalSequences, layers.body.atlas)
        : bodySequences(ir, bmdByStem.get(stem) ?? stem, layers.body.atlas),
    ]),
  );
  // As the sheet does, the first civilization is the base every other one fills its missing looks from.
  const tables = new Map<number, CharacterTableUnderTest>();
  const basePrograms = tribeAtomicPrograms(ir, civilizations[0]);
  let base: CharacterTableUnderTest;
  for (const tribe of civilizations) {
    const inputs = {
      looks: looksByTribe.get(tribe) ?? new Map(),
      animalJobs: animalJobsByTribe.get(tribe) ?? new Map(),
      layersByBody,
      sequencesByBody,
      sequences: allSequences,
      basePrograms,
    };
    const table = tribeCharacters(ir, goods, tribe, inputs, base);
    base ??= table;
    tables.set(tribe, table);
  }
  return tables;
}
