import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type { ContentSet } from '@open-northland/data';
import { atlasFromManifest, type SpriteLayer, type TextureSource } from '@open-northland/render';
import { INDEXED_CHARACTER_PALETTE } from '../../src/catalog/roster.js';
import { humanSequences, playableSequences } from '../../src/content/ir/joins.js';
import type { ContentIr } from '../../src/content/ir/rows.js';
import { loadRealContent, mergeRealContent, type RealContentMerge } from '../../src/content/real-content.js';
import type { LoadedLook } from '../../src/content/sprite-sheet/character-looks.js';
import { resolveLooks } from '../../src/content/sprite-sheet/character-looks.js';
import { tribeCharacters } from '../../src/content/sprite-sheet/tribe-characters.js';
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
 * The character tables of `civilizations` resolved over the generated body atlases, the way the sprite
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
  return new Map(
    civilizations.map((tribe) => [
      tribe,
      tribeCharacters(ir, [], tribe, {
        looks: looksByTribe.get(tribe) ?? new Map(),
        layersByBody,
        sequencesByBody,
      }),
    ]),
  );
}
