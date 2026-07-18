import { describe, expect, it } from 'vitest';
import type { ContentIr, LandscapeGfxRow } from '../src/content/ir.js';
import { BUSH_WITH_FRUITS_LOGIC_TYPE } from '../src/content/map-resources.js';
import {
  type BerryBushRef,
  berryBushAtlasStems,
  buildBerryBushBinding,
  resolveBerryBushRefs,
} from '../src/content/resource-gfx/index.js';
import { landscapeRow } from './support/landscape.js';

/**
 * The forageable-berry-bush render binding — the self-verifiable half of "draw a bush per growth stage".
 * Proves the three-stage twin join (`fruits`→`flower`/`empty`, matched by editName) and the load-then-
 * drop-unloaded fallback chain (flowering→ripe, bare→flowering) deterministically without a browser; the
 * pixels are the `?scene=berries` acceptance scene's job.
 */

const FRUITS_LT = BUSH_WITH_FRUITS_LOGIC_TYPE; // 11 — only these records seed a bush ref
const FLOWER_LT = 10;
const EMPTY_LT = 9;

/** A one-state bush `[GfxLandscape]` row in the `ls_trees` bmd, recoloured by `palette`. */
function bushRow(
  index: number,
  logicType: number,
  palette: string,
  bob: number,
  editName: string,
): LandscapeGfxRow {
  return landscapeRow(index, logicType, palette, [{ state: 1, bobIds: [bob] }], 'ls_trees', editName);
}

// bush 01: fruits + flower share the `bush01` palette (one served stem), empty draws from the `tree01`
// palette (the original's naked-bush look) — a distinct stem, so its atlas can be absent independently.
const BUSH01_FRUITS = bushRow(806, FRUITS_LT, 'bush01', 288, 'bush 01 fruits');
const BUSH01_FLOWER = bushRow(805, FLOWER_LT, 'bush01', 279, 'bush 01 flower');
const BUSH01_EMPTY = bushRow(325, EMPTY_LT, 'tree01', 270, 'bush 01 empty');

const RIPE_STEM = 'ls_trees.bush01';
const BARE_STEM = 'ls_trees.tree01';

function irOf(...rows: readonly LandscapeGfxRow[]): ContentIr {
  return { landscapeGfx: [...rows] } as ContentIr;
}

/** Resolve and assert exactly one bush ref (the fixtures each define a single fruited bush). */
function oneRef(...rows: readonly LandscapeGfxRow[]): BerryBushRef {
  const [ref, ...rest] = resolveBerryBushRefs(irOf(...rows));
  expect(rest).toHaveLength(0);
  if (ref === undefined) throw new Error('expected one berry bush ref');
  return ref;
}

describe('resolveBerryBushRefs — the fruited-bush record + its flower/empty twins', () => {
  it('resolves all three stages to distinct stem/bob draws, keyed by the fruited record index', () => {
    expect(oneRef(BUSH01_FRUITS, BUSH01_FLOWER, BUSH01_EMPTY)).toEqual({
      gfxIndex: 806,
      ripe: { stem: RIPE_STEM, bob: 288 },
      flowering: { stem: RIPE_STEM, bob: 279 },
      bare: { stem: BARE_STEM, bob: 270 },
    });
  });

  it('falls the missing stages down the cycle: no flower → ripe, no empty → flowering', () => {
    const noFlower = oneRef(BUSH01_FRUITS, BUSH01_EMPTY);
    expect(noFlower.flowering).toEqual(noFlower.ripe); // flower twin absent → reuse the fruited frame

    const onlyFruits = oneRef(BUSH01_FRUITS);
    expect(onlyFruits.flowering).toEqual(onlyFruits.ripe);
    expect(onlyFruits.bare).toEqual(onlyFruits.flowering); // empty absent → its flowering (here the ripe frame)

    const noEmpty = oneRef(BUSH01_FRUITS, BUSH01_FLOWER);
    expect(noEmpty.bare).toEqual(noEmpty.flowering); // empty twin absent → reuse the flowering frame
  });

  it('seeds a ref only from a fruited record (ignores the flower/empty twins as anchors)', () => {
    // Flower + empty alone, no fruits record → no bush ref (they are twins, not anchors).
    expect(resolveBerryBushRefs(irOf(BUSH01_FLOWER, BUSH01_EMPTY))).toEqual([]);
  });

  it('drops a fruited record that names no drawable frame, and degrades to [] on an older ir.json', () => {
    const noFrames = landscapeRow(900, FRUITS_LT, 'bush01', undefined, 'ls_trees', 'bush 09 fruits');
    expect(resolveBerryBushRefs(irOf(noFrames))).toEqual([]);
    expect(resolveBerryBushRefs(null)).toEqual([]);
  });
});

describe('berryBushAtlasStems — the atlases every stage draws from', () => {
  it('collects the ripe, flowering and bare served stems (deduped)', () => {
    const refs = resolveBerryBushRefs(irOf(BUSH01_FRUITS, BUSH01_FLOWER, BUSH01_EMPTY));
    expect(berryBushAtlasStems(refs)).toEqual(new Set([RIPE_STEM, BARE_STEM]));
  });
});

describe('buildBerryBushBinding — the per-variant three-frame level list', () => {
  const refs = resolveBerryBushRefs(irOf(BUSH01_FRUITS, BUSH01_FLOWER, BUSH01_EMPTY));

  it('binds [bare, flowering, ripe] (level 1/2/3) when every stage atlas loaded', () => {
    const binding = buildBerryBushBinding(refs, new Set([RIPE_STEM, BARE_STEM]));
    expect(binding).toBeDefined();
    expect(binding?.byGfxIndex?.[806]).toEqual([
      { layer: BARE_STEM, bob: 270 }, // level 1
      { layer: RIPE_STEM, bob: 279 }, // level 2 (flowering shares the bush01 stem)
      { layer: RIPE_STEM, bob: 288 }, // level 3
    ]);
    expect(binding?.default).toEqual({ layer: RIPE_STEM, bob: 288 }); // the first bush's ripe frame
  });

  it('falls a stage whose atlas is absent to the next-higher loaded frame', () => {
    // Give the flower record its own distinct stem so it can be independently absent from the loaded set.
    const distinctFlower = bushRow(805, FLOWER_LT, 'bushflower', 279, 'bush 01 flower');
    const FLOWER_STEM = 'ls_trees.bushflower';
    const distinctRefs = resolveBerryBushRefs(irOf(BUSH01_FRUITS, distinctFlower, BUSH01_EMPTY));

    // Ripe loaded, flower + empty atlases absent → both draw the fruited frame.
    const ripeOnly = buildBerryBushBinding(distinctRefs, new Set([RIPE_STEM]));
    expect(ripeOnly?.byGfxIndex?.[806]).toEqual([
      { layer: RIPE_STEM, bob: 288 }, // bare → flowering → ripe frame
      { layer: RIPE_STEM, bob: 288 }, // flowering → ripe frame
      { layer: RIPE_STEM, bob: 288 },
    ]);

    // Ripe + flower loaded, empty absent → bare reuses the flowering frame.
    const noBare = buildBerryBushBinding(distinctRefs, new Set([RIPE_STEM, FLOWER_STEM]));
    expect(noBare?.byGfxIndex?.[806]).toEqual([
      { layer: FLOWER_STEM, bob: 279 }, // bare → flowering frame
      { layer: FLOWER_STEM, bob: 279 }, // flowering
      { layer: RIPE_STEM, bob: 288 }, // ripe
    ]);
  });

  it('drops a bush whose ripe atlas never loaded, and returns undefined when nothing binds', () => {
    expect(buildBerryBushBinding(refs, new Set([BARE_STEM]))).toBeUndefined(); // no fruited atlas → placeholder
    expect(buildBerryBushBinding([], new Set([RIPE_STEM]))).toBeUndefined();
  });
});
