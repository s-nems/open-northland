import { describe, expect, it } from 'vitest';
import type { ContentIr, LandscapeGfxRow } from '../src/content/ir.js';
import {
  DEFAULT_RESOURCE_STEM,
  FLAG_EDIT_NAME,
  buildResourceBinding,
  buildStockpileBinding,
  buildTrunkBinding,
  gatheringAtlasStems,
  nodeBob,
  pileFillBobs,
  resolveGatheringRefs,
  servedStem,
} from '../src/content/resource-gfx.js';
import type { GoodRef } from '../src/content/settler-gfx.js';

/**
 * The gathering-economy render binding — the self-verifiable half of "draw each resource/pile/flag from
 * the Step-1 pipeline join". Proves the good→landscape→gfx reduction (representative pick, fill states,
 * the id-slug match, the default-vs-family layer decision, the load-then-drop-unloaded rule)
 * deterministically without a browser; the pixels are the `?scene=sandbox` acceptance scene's job.
 */

const B = 'data/engine2d/bin/bobs';
// The default resource family stem is `ls_trees.tree_yew01` — a wood node record in it binds a BARE bob.
const WOOD_NODE: LandscapeGfxRow = {
  index: 100,
  editName: 'yew 01',
  logicType: 4,
  bmd: `${B}/ls_trees.bmd`,
  paletteName: 'tree_yew01',
  frames: [
    { state: 3, bobIds: [60, 61] }, // highest state = the full tree → nodeBob 60
    { state: 1, bobIds: [196] },
  ],
};
const STONE_NODE: LandscapeGfxRow = {
  index: 101,
  editName: 'stones 01',
  logicType: 15,
  bmd: `${B}/ls_ground.bmd`,
  paletteName: 'rock03',
  frames: [{ state: 4, bobIds: [10] }],
};
// The pickup-stage TRUNK (a felled log on the ground) — its own record/atlas, distinct from the pile.
const WOOD_TRUNK: LandscapeGfxRow = {
  index: 150,
  editName: 'wood trunk 01',
  logicType: 6,
  bmd: `${B}/ls_goods.bmd`,
  paletteName: 'goods_trunk',
  frames: [{ state: 1, bobIds: [70] }],
};
const WOOD_PILE: LandscapeGfxRow = {
  index: 200,
  editName: 'wood pile 01',
  logicType: 7,
  bmd: `${B}/ls_goods.bmd`,
  paletteName: 'goods_wood',
  // Deliberately file-order DESCENDING by state — pileFillBobs must sort fewest→most.
  frames: [
    { state: 5, bobIds: [4] },
    { state: 4, bobIds: [3] },
    { state: 3, bobIds: [2] },
    { state: 2, bobIds: [1] },
    { state: 1, bobIds: [0] },
  ],
};
const STONE_PILE: LandscapeGfxRow = {
  index: 201,
  editName: 'stone pile 01',
  logicType: 17,
  bmd: `${B}/ls_goods.bmd`,
  paletteName: 'goods_stone',
  frames: [
    { state: 1, bobIds: [15] },
    { state: 2, bobIds: [16] },
  ],
};
const FLAG: LandscapeGfxRow = {
  index: 300,
  editName: FLAG_EDIT_NAME,
  logicType: 1,
  bmd: `${B}/ls_temp.bmd`,
  paletteName: 'human_player01',
  frames: [{ state: 1, bobIds: [33] }],
};

const IR: ContentIr = {
  landscapeGfx: [WOOD_NODE, STONE_NODE, WOOD_TRUNK, WOOD_PILE, STONE_PILE, FLAG],
  gatheringPipeline: [
    {
      goodType: 55, // the REAL goodType — deliberately not the scene's (proves the id-slug match)
      goodId: 'wood',
      harvest: { landscapeType: 4, gfxIndices: [100] },
      pickup: { landscapeType: 6, gfxIndices: [150] },
      store: { landscapeType: 7, gfxIndices: [200] },
    },
    {
      goodType: 33,
      goodId: 'stone',
      harvest: { landscapeType: 15, gfxIndices: [101] },
      store: { landscapeType: 17, gfxIndices: [201] },
    },
  ],
};

// Scene goods: typeIds deliberately DIFFER from the pipeline's — the join is by id-slug.
const GOODS: readonly GoodRef[] = [
  { typeId: 1, id: 'wood' },
  { typeId: 2, id: 'stone' },
];

describe('servedStem / nodeBob / pileFillBobs', () => {
  it('derives the served atlas stem (<bmd-stem>.<palette>) from a record', () => {
    expect(servedStem(WOOD_NODE)).toBe('ls_trees.tree_yew01');
    expect(servedStem(STONE_NODE)).toBe('ls_ground.rock03');
    expect(servedStem(WOOD_PILE)).toBe('ls_goods.goods_wood');
  });

  it('returns undefined for a record naming no bmd or palette', () => {
    expect(servedStem({ index: 1, logicType: 0 })).toBeUndefined();
    expect(servedStem({ index: 1, logicType: 0, bmd: `${B}/x.bmd` })).toBeUndefined();
  });

  it('picks the highest-state first bob as the full-grown node frame', () => {
    expect(nodeBob(WOOD_NODE)).toBe(60); // state 3 wins over state 1
    expect(nodeBob(FLAG)).toBe(33);
    expect(nodeBob({ index: 1, logicType: 0 })).toBeUndefined();
  });

  it('orders pile fill bobs fewest→most units regardless of file order', () => {
    expect(pileFillBobs(WOOD_PILE)).toEqual([0, 1, 2, 3, 4]); // state 1..5 → bob 0..4
    expect(pileFillBobs(STONE_PILE)).toEqual([15, 16]);
  });
});

describe('resolveGatheringRefs — the good→landscape→gfx join, matched by id-slug', () => {
  it('binds each scene good (by slug) to its node + pile under the SCENE typeId', () => {
    const refs = resolveGatheringRefs(GOODS, IR);
    // Node refs carry per-level bobs, empty→full (a mined deposit shrinks through them); a non-mined node
    // (one state) is a single-frame list. Wood: state 1 (196) then state 3 (60); stone: one state (10).
    expect(refs.nodesByGood[1]).toEqual({ stem: 'ls_trees.tree_yew01', bobs: [196, 60] }); // wood → yew
    expect(refs.nodesByGood[2]).toEqual({ stem: 'ls_ground.rock03', bobs: [10] }); // stone → rock
    expect(refs.pilesByGood[1]).toEqual({ stem: 'ls_goods.goods_wood', fillBobs: [0, 1, 2, 3, 4] });
    expect(refs.pilesByGood[2]).toEqual({ stem: 'ls_goods.goods_stone', fillBobs: [15, 16] });
    expect(refs.trunksByGood[1]).toEqual({ stem: 'ls_goods.goods_trunk', bob: 70 }); // wood → pickup log
    expect(refs.trunksByGood[2]).toBeUndefined(); // stone has no pickup stage in this fixture
    expect(refs.flag).toEqual({ stem: 'ls_temp.human_player01', bob: 33 });
  });

  it('skips a scene good with no matching pipeline slug', () => {
    const refs = resolveGatheringRefs([{ typeId: 9, id: 'unobtainium' }], IR);
    expect(refs.nodesByGood).toEqual({});
    expect(refs.pilesByGood).toEqual({});
  });

  it('is empty (but never throws) on an absent IR', () => {
    const refs = resolveGatheringRefs(GOODS, null);
    expect(refs.nodesByGood).toEqual({});
    expect(refs.flag).toBeUndefined();
  });
});

describe('resolveGatheringRefs — the goods-manifest pile/trunk binding (every good draws its own heap)', () => {
  // A manifest good carries its full growth-state fillFrames (fewest→most) + the state-1 icon frame.
  const ICONS = new Map([['bread', { frame: 85, palette: 'goods_bread', fillFrames: [85, 86, 87] }]]);

  it('binds a non-gathered good to its ls_goods GROWING pile (all fill states) AND single-frame trunk', () => {
    const refs = resolveGatheringRefs([{ typeId: 20, id: 'bread' }], IR, ICONS);
    // The pile grows through every manifest fill state; the trunk (felled-log shape) stays the state-1 icon.
    expect(refs.pilesByGood[20]).toEqual({ stem: 'ls_goods.goods_bread', fillBobs: [85, 86, 87] });
    expect(refs.trunksByGood[20]).toEqual({ stem: 'ls_goods.goods_bread', bob: 85 });
  });

  it('falls back to the neutral generic heap (goods01, bob 0) for a good with no manifest icon', () => {
    const refs = resolveGatheringRefs([{ typeId: 21, id: 'potion_heal_big' }], IR, ICONS);
    expect(refs.pilesByGood[21]).toEqual({ stem: 'ls_goods.goods01', fillBobs: [0] });
    expect(refs.trunksByGood[21]).toEqual({ stem: 'ls_goods.goods01', bob: 0 });
  });

  it("does NOT override a gathered good's richer pipeline pile with the manifest frames", () => {
    const wood = new Map([['wood', { frame: 99, palette: 'goodsX', fillFrames: [99] }]]);
    const refs = resolveGatheringRefs(GOODS, IR, wood);
    expect(refs.pilesByGood[1]).toEqual({ stem: 'ls_goods.goods_wood', fillBobs: [0, 1, 2, 3, 4] });
  });

  it('adds nothing when no manifest is provided (back-compat with the pipeline-only path)', () => {
    const refs = resolveGatheringRefs([{ typeId: 20, id: 'bread' }], IR);
    expect(refs.pilesByGood[20]).toBeUndefined();
    expect(refs.trunksByGood[20]).toBeUndefined();
  });
});

describe('gatheringAtlasStems — the families to load', () => {
  it('lists every non-default node stem, pile stem, and the flag stem (default excluded)', () => {
    const stems = gatheringAtlasStems(resolveGatheringRefs(GOODS, IR));
    expect(stems.has(DEFAULT_RESOURCE_STEM)).toBe(false); // the yew is kindLayers.resource, not a family
    expect(stems).toEqual(
      new Set([
        'ls_ground.rock03',
        'ls_goods.goods_trunk',
        'ls_goods.goods_wood',
        'ls_goods.goods_stone',
        'ls_temp.human_player01',
      ]),
    );
  });
});

describe('buildTrunkBinding — the freshly-felled trunk (pickup stage), drop-unloaded', () => {
  const refs = resolveGatheringRefs(GOODS, IR);

  it('binds a good with a loaded pickup family to its trunk log, layer-qualified', () => {
    const binding = buildTrunkBinding(refs, new Set(['ls_goods.goods_trunk']));
    // A trunk/ore-pile is a single log frame — a one-element level list (a drop carries no level).
    expect(binding.byGood[1]).toEqual([{ layer: 'ls_goods.goods_trunk', bob: 70 }]); // wood → its trunk
    expect(binding.byGood[2]).toBeUndefined(); // stone has no pickup stage
  });

  it('drops a good whose pickup family failed to load (falls back to the default at draw time)', () => {
    const binding = buildTrunkBinding(refs, new Set()); // trunk atlas not loaded
    expect(binding.byGood[1]).toBeUndefined();
    expect(typeof binding.default).toBe('number'); // TREE_BOB fallback
  });
});

describe('buildResourceBinding — the default-vs-family layer decision + drop-unloaded', () => {
  const refs = resolveGatheringRefs(GOODS, IR);

  it('draws a bare bob for the default family, layer-qualified for a loaded named family', () => {
    const loaded = new Set(['ls_ground.rock03']);
    const binding = buildResourceBinding(refs, loaded);
    // Per-level frame lists, empty→full: wood bare bobs from the default tree layer, stone layer-qualified.
    expect(binding.byGood[1]).toEqual([196, 60]); // wood → bare (default tree layer)
    expect(binding.byGood[2]).toEqual([{ layer: 'ls_ground.rock03', bob: 10 }]); // stone → its family
    expect(binding.default).toBe(60); // TREE_BOB fallback
  });

  it('drops a good whose named family failed to load (it falls back to the yew default)', () => {
    const binding = buildResourceBinding(refs, new Set()); // rock atlas not loaded
    expect(binding.byGood[1]).toEqual([196, 60]); // wood still binds (default family needs no load)
    expect(binding.byGood[2]).toBeUndefined(); // stone dropped → resolves to `default` at draw time
  });
});

describe('buildStockpileBinding — per-good heap frames + the flag, drop-unloaded', () => {
  const refs = resolveGatheringRefs(GOODS, IR);

  it('binds loaded pile families as layer-qualified fill frames + the loaded flag', () => {
    const loaded = new Set(['ls_goods.goods_wood', 'ls_goods.goods_stone', 'ls_temp.human_player01']);
    const binding = buildStockpileBinding(refs, loaded);
    expect(binding.byGood[1]).toEqual([
      { layer: 'ls_goods.goods_wood', bob: 0 },
      { layer: 'ls_goods.goods_wood', bob: 1 },
      { layer: 'ls_goods.goods_wood', bob: 2 },
      { layer: 'ls_goods.goods_wood', bob: 3 },
      { layer: 'ls_goods.goods_wood', bob: 4 },
    ]);
    expect(binding.byGood[2]).toHaveLength(2);
    expect(binding.flag).toEqual({ layer: 'ls_temp.human_player01', bob: 33 });
  });

  it('drops an unloaded pile family and falls the flag back to a bare placeholder', () => {
    const binding = buildStockpileBinding(refs, new Set()); // nothing loaded
    expect(binding.byGood[1]).toBeUndefined();
    expect(typeof binding.flag).toBe('number'); // bare placeholder ref (drawn as the sandy heap)
    expect(typeof binding.default).toBe('number');
  });
});
