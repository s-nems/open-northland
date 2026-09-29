import type { JobGraphics, RandomPaletteRecipe } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { parseIniSections } from '../src/decoders/ini.js';
import { PLAYER_COLORS } from '../src/decoders/player-palette.js';
import { extractRandomPalettes } from '../src/decoders/random-palette.js';
import {
  buildHumanPalettes,
  goodPaletteRecipes,
  type HumanPaletteSources,
} from '../src/stages/ir/human-palettes.js';
import { solidPalette } from './fixtures/palette.js';

/** The ten shipped player colours with `player_NN` / `woman_NN` recipes. */
const SHIPPED_COLORS = 10;
const pad = (n: number): string => String(n).padStart(2, '0');

const ramp = (band: number, name: string, weight = 10) =>
  ({ band, source: { kind: 'ramp', ramp: name }, weight }) as const;
const copy = (band: number, from: number, weight = 10) =>
  ({ band, source: { kind: 'copy', band: from }, weight }) as const;

/** The recipes the lane must reach, mirroring the real file's shapes, plus one nothing reaches. */
function recipes(): RandomPaletteRecipe[] {
  const out: RandomPaletteRecipe[] = [{ name: 'unused', patches: [ramp(3, 'orphan ramp')] }];
  for (let c = 0; c < SHIPPED_COLORS; c++) {
    out.push({ name: `player_${pad(c)}`, patches: [ramp(10, `player ${pad(c)}`), copy(5, 10)] });
    out.push({ name: `woman_${pad(c)}`, patches: [ramp(15, `player ${pad(c)}`)] });
  }
  for (let tier = 0; tier < 5; tier++) {
    out.push({ name: `human_armor_00${tier}`, patches: [ramp(11, 'colors grey')] });
  }
  out.push({ name: 'good_handcart', patches: [ramp(15, 'colors grey')] });
  out.push({ name: 'good_oxcart', patches: [ramp(15, 'colors grey')] });
  out.push({ name: 'vik_woman_base', patches: [copy(14, 15), copy(14, 1)] });
  out.push({ name: 'vik_man_changejobtrader', patches: [ramp(13, 'colors grey')] });
  out.push({ name: 'vik_man_changejob', patches: [ramp(12, 'colors grey')] });
  return out;
}

/** `palettes.ini`: the shipped player palettes (ramp = colour range 1), the colours file, and a base. */
function paletteIni(): string {
  const lines: string[] = [];
  for (let c = 0; c < SHIPPED_COLORS; c++) {
    lines.push(
      `[GfxPalette256]\neditname "human_Player${pad(c + 1)}"\ngfxfile "data\\player${pad(c + 1)}.pcx"`,
    );
    lines.push(`[GfxPalette16]\neditname "Player ${pad(c)}"\ngfxcolorrange "Human_Player${pad(c + 1)}" 1`);
  }
  lines.push('[GfxPalette256]\neditname "human_colors"\ngfxfile "data\\colors.pcx"');
  lines.push('[GfxPalette16]\neditname "colors grey"\ngfxcolorrange "human_colors" 14');
  lines.push('[GfxPalette256]\neditname "test_human_00"\ngfxfile "data\\base.pcx"');
  return lines.join('\n');
}

/** Each `.pcx` is one solid colour: player files pure red, the colours file grey, the base black. */
const FILE_COLORS: Readonly<Record<string, readonly [number, number, number]>> = {
  'data/colors.pcx': [128, 128, 128],
  'data/base.pcx': [0, 0, 0],
};

const WOMAN_LOOK: JobGraphics = {
  tribe: 1,
  job: 5,
  body: 'data/engine2d/bin/bobs/cr_hum_body_20.bmd',
  heads: [],
  bodyPalette: 'test_human_00',
  headPalette: 'test_human_00',
  randomPalettes: ['vik_woman_base'],
};

function sources(overrides: Partial<HumanPaletteSources> = {}): HumanPaletteSources {
  return {
    recipes: recipes(),
    paletteSections: parseIniSections(paletteIni()),
    jobGraphics: [WOMAN_LOOK],
    jobChanges: [
      { tribe: 1, job: 25, recipes: ['vik_man_changejobtrader', 'vik_man_changejob'] },
      { tribe: 1, job: 30, recipes: [] },
      { tribe: 1, job: 31, recipes: ['vik_man_changejob', 'bear01'] },
    ],
    goods: [],
    loadPalette: async (file) => {
      const [r, g, b] = FILE_COLORS[file] ?? [255, 0, 0];
      return solidPalette(r, g, b);
    },
    ...overrides,
  };
}

const hexOf = (r: number, g: number, b: number, entries: number): string =>
  [r, g, b]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')
    .repeat(entries);

describe('buildHumanPalettes', () => {
  it('keeps the reachable recipes in file order, then the synthetic player colours', async () => {
    const lane = await buildHumanPalettes(sources());
    const names = lane.recipes.map((r) => r.name);
    expect(names).not.toContain('unused');
    expect(names.slice(0, 2)).toEqual(['player_00', 'woman_00']);
    expect(names).toContain('vik_woman_base');
    expect(names.at(-1)).toBe('synthetic_woman_15');
    expect(lane.recipes.find((r) => r.name === 'vik_woman_base')?.patches).toEqual([
      copy(14, 15),
      copy(14, 1),
    ]);
  });

  it('maps shipped colours to their recipes and synthesizes hue-rotated twins of colour 0', async () => {
    const lane = await buildHumanPalettes(sources());
    expect(lane.players).toHaveLength(PLAYER_COLORS.length);
    expect(lane.players[3]).toEqual({ player: 3, male: 'player_03', female: 'woman_03' });
    expect(lane.players[12]).toEqual({
      player: 12,
      male: 'synthetic_player_12',
      female: 'synthetic_woman_12',
    });
    const synthetic = lane.recipes.find((r) => r.name === 'synthetic_player_12');
    const hue = PLAYER_COLORS[12]?.source.kind === 'synthetic' ? PLAYER_COLORS[12].source.hue : -1;
    expect(synthetic?.patches).toEqual([ramp(10, `player 00 hue ${hue}`), copy(5, 10)]);
    // Pure red rotated to the colour's hue keeps full saturation and value.
    expect(lane.ramps[`player 00 hue ${hue}`]).toHaveLength(96);
    expect(lane.ramps[`player 00 hue ${hue}`]).not.toBe(lane.ramps['player 00']);
  });

  it('resolves every referenced ramp and base palette to hex colours', async () => {
    const lane = await buildHumanPalettes(sources());
    expect(lane.ramps['player 00']).toBe(hexOf(255, 0, 0, 16));
    expect(lane.ramps['colors grey']).toBe(hexOf(128, 128, 128, 16));
    expect(lane.ramps['orphan ramp']).toBeUndefined();
    expect(Object.keys(lane.bases)).toEqual(['test_human_00']);
    expect(lane.bases.test_human_00).toBe(hexOf(0, 0, 0, 256));
  });

  it('names the armor tiers and carts, and keeps the last recipe a job change lists', async () => {
    const lane = await buildHumanPalettes(sources());
    expect(lane.armorRecipes).toEqual([0, 1, 2, 3, 4].map((t) => `human_armor_00${t}`));
    expect(lane.cartRecipes).toEqual({ handcart: 'good_handcart', oxcart: 'good_oxcart' });
    expect(lane.jobChanges[0]).toEqual({ tribe: 1, job: 25, recipe: 'vik_man_changejob' });
  });

  it('keeps a job change record whose last name is absent or unknown, without a recipe', async () => {
    const lane = await buildHumanPalettes(sources());
    // The record still stops the runtime's walk to the parent job's record.
    expect(lane.jobChanges.slice(1)).toEqual([
      { tribe: 1, job: 30 },
      { tribe: 1, job: 31 },
    ]);
  });

  it('keeps a look rolling a name no recipe carries, which reaches nothing', async () => {
    const look = { ...WOMAN_LOOK, randomPalettes: ['vik_woman_base', 'bear01'] };
    const lane = await buildHumanPalettes(sources({ jobGraphics: [look] }));
    expect(lane.recipes.map((r) => r.name)).not.toContain('bear01');
  });

  it('throws on a player recipe, ramp or base palette that does not resolve', async () => {
    const withoutWoman = recipes().filter((r) => r.name !== 'woman_04');
    await expect(buildHumanPalettes(sources({ recipes: withoutWoman }))).rejects.toThrow(
      /player colour 4 names unknown recipe "woman_04"/,
    );
    const brokenRamp = recipes().map((r) =>
      r.name === 'vik_woman_base' ? { ...r, patches: [ramp(2, 'no such ramp')] } : r,
    );
    await expect(buildHumanPalettes(sources({ recipes: brokenRamp }))).rejects.toThrow(
      /"vik_woman_base" names unknown ramp "no such ramp"/,
    );
    await expect(
      buildHumanPalettes(sources({ jobGraphics: [{ ...WOMAN_LOOK, bodyPalette: 'nowhere' }] })),
    ).rejects.toThrow(/no \[GfxPalette256\] named "nowhere"/);
  });
});

describe('goodPaletteRecipes', () => {
  // One recipe per matching rule, a duplicate, the cart recipes, and a recipe of no good.
  const GOOD_RECIPES_INI = [
    'good_Wheat',
    'good_holyoil',
    'good_bow',
    'good_potion_food',
    'good_clay',
    'good_tools_iron',
    'good_tile',
    'good_tile',
    'good_HandCart',
    'good_OxCart',
    'good_nothing',
    'vik_man_base',
  ]
    .map((name, i) => `[RandomPalette]\nName "${name}"\nPatch 14 "colors ${i}" 10\n`)
    .join('\n');
  const goods = [
    { typeId: 4, id: 'wheat' },
    { typeId: 15, id: 'holy_oil' },
    { typeId: 37, id: 'bow_short' },
    { typeId: 38, id: 'bow_long' },
    { typeId: 44, id: 'potion_food_small' },
    { typeId: 45, id: 'potion_food_big' },
    { typeId: 46, id: 'potion_stamina_small' },
    { typeId: 2, id: 'mud' },
    { typeId: 32, id: 'tool_iron' },
    { typeId: 25, id: 'tile' },
    { typeId: 59, id: 'handcart' },
  ];

  it('matches a good by name, then by name prefix, then by the alias table, leaving the carts out', () => {
    const recipes = extractRandomPalettes(parseIniSections(GOOD_RECIPES_INI));
    expect(goodPaletteRecipes(recipes, goods)).toEqual([
      { good: 4, recipe: 'good_wheat' },
      { good: 15, recipe: 'good_holyoil' },
      { good: 37, recipe: 'good_bow' },
      { good: 38, recipe: 'good_bow' },
      { good: 44, recipe: 'good_potion_food' },
      { good: 45, recipe: 'good_potion_food' },
      { good: 2, recipe: 'good_clay' },
      { good: 32, recipe: 'good_tools_iron' },
      { good: 25, recipe: 'good_tile' },
    ]);
  });
});
