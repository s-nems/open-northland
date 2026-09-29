import {
  emptyHumanPalettes,
  type HumanPalettes,
  type JobGraphics,
  type PlayerPaletteRecipes,
  type RandomPaletteRecipe,
} from '@open-northland/data';
import { assertPaletteBytes } from '../../decoders/image.js';
import {
  extractPaletteIndex,
  iniBytesToSections,
  paletteAliasMap,
  type RuleSection,
  rampAliasMap,
} from '../../decoders/ini.js';
import { decodePcx } from '../../decoders/pcx.js';
import { hueRotateRamp, PLAYER_COLORS, type PlayerColorDef } from '../../decoders/player-palette.js';
import { cutRamp, extractRandomPalettes } from '../../decoders/random-palette.js';
import { resolveSourceFile, type SourceRoots } from '../../roots.js';
import { readSourceFile } from '../source-files.js';
import type { JobChangeRecipes } from './job-graphics.js';

const RANDOMPALETTE_INI = 'Data/engine2d/inis/humans/randompalette.ini';
const PALETTES_INI = 'Data/engine2d/inis/palettes/palettes.ini';

/** `TArmorType` tiers: none, wool, leather, chain, plate. */
const ARMOR_TIERS = 5;
/** Original behavior: a soldier's armor recipe is `human_armor_%3.3d` of its armor type. */
const armorRecipeName = (tier: number): string => `human_armor_${String(tier).padStart(3, '0')}`;
/** Original behavior: player colour `n` gives males `player_%2.2d` and females `woman_%2.2d`. */
const maleRecipeName = (color: number): string => `player_${String(color).padStart(2, '0')}`;
const femaleRecipeName = (color: number): string => `woman_${String(color).padStart(2, '0')}`;
/** The recipes a crewed handcart and ox cart apply to their driver. */
const CART_RECIPES = { handcart: 'good_handcart', oxcart: 'good_oxcart' } as const;
/** The shipped colour whose recipes the synthetic player colours mirror. */
const SYNTHETIC_TEMPLATE_COLOR = 0;

/** Everything {@link buildHumanPalettes} reads, already parsed; `loadPalette` reads a `gfxfile` `.pcx`
 *  trailer and throws when it cannot. */
export interface HumanPaletteSources {
  /** Every `[RandomPalette]` recipe, in file order. */
  readonly recipes: readonly RandomPaletteRecipe[];
  /** The `palettes.ini` sections naming the `[GfxPalette256]` files and `[GfxPalette16]` ramps. */
  readonly paletteSections: readonly RuleSection[];
  readonly jobGraphics: readonly JobGraphics[];
  readonly jobChanges: readonly JobChangeRecipes[];
  readonly loadPalette: (gfxFile: string) => Promise<Uint8Array>;
}

const toHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

/** A synthetic colour's copy of a template recipe, every ramp swapped for its hue-rotated twin. */
function synthesizeRecipe(template: RandomPaletteRecipe, name: string, hue: number): RandomPaletteRecipe {
  return {
    name,
    patches: template.patches.map((patch) =>
      patch.source.kind === 'ramp'
        ? { ...patch, source: { kind: 'ramp', ramp: syntheticRampName(patch.source.ramp, hue) } }
        : patch,
    ),
  };
}

const syntheticRampName = (ramp: string, hue: number): string => `${ramp} hue ${hue}`;

/**
 * Composes the `humanPalettes` lane: the recipes every human look, job change, player colour, armor tier
 * and cart can reach, the ramps those recipes name resolved to their 16 colours, and the base palettes
 * the looks name. Throws on a player, armor or cart recipe, a ramp or a base palette that does not
 * resolve.
 *
 * Player colours 10..15 have no original. Approximation: their recipes copy colour 0's with every ramp
 * hue-rotated to the colour's {@link PLAYER_COLORS} hue.
 */
export async function buildHumanPalettes(sources: HumanPaletteSources): Promise<HumanPalettes> {
  const recipeByName = new Map(sources.recipes.map((r) => [r.name, r]));
  const reached = new Set<string>();
  const reach = (name: string, by: string): string => {
    if (!recipeByName.has(name)) throw new Error(`human palettes: ${by} names unknown recipe "${name}"`);
    reached.add(name);
    return name;
  };
  const recipeOf = (name: string, by: string): RandomPaletteRecipe => {
    const recipe = recipeByName.get(reach(name, by));
    if (recipe === undefined) throw new Error(`human palettes: recipe "${name}" vanished`);
    return recipe;
  };

  // Original behavior: a `gfxpaletterandom` name no recipe carries still takes its share of the roll
  // and changes nothing, and a job change record whose last name is absent or unknown applies no recipe.
  // That record is kept without one: it still stops the runtime's walk up to the parent job's record.
  for (const look of sources.jobGraphics) {
    for (const name of look.randomPalettes) if (recipeByName.has(name)) reached.add(name);
  }
  const jobChanges = sources.jobChanges.map(({ tribe, job, recipes }) => {
    const last = recipes.at(-1);
    return last === undefined || !recipeByName.has(last)
      ? { tribe, job }
      : { tribe, job, recipe: reach(last, 'job change') };
  });
  const armorRecipes = Array.from({ length: ARMOR_TIERS }, (_, tier) =>
    reach(armorRecipeName(tier), 'armor tier'),
  );
  const cartRecipes = {
    handcart: reach(CART_RECIPES.handcart, 'handcart'),
    oxcart: reach(CART_RECIPES.oxcart, 'ox cart'),
  };

  const synthetic: { recipe: RandomPaletteRecipe; template: RandomPaletteRecipe; hue: number }[] = [];
  const playerRecipes = (color: PlayerColorDef): PlayerPaletteRecipes => {
    if (color.source.kind === 'pcx') {
      return {
        player: color.id,
        male: reach(maleRecipeName(color.id), `player colour ${color.id}`),
        female: reach(femaleRecipeName(color.id), `player colour ${color.id}`),
      };
    }
    const { hue } = color.source;
    const pad = String(color.id).padStart(2, '0');
    const pair = [
      [recipeOf(maleRecipeName(SYNTHETIC_TEMPLATE_COLOR), 'synthetic player'), `synthetic_player_${pad}`],
      [recipeOf(femaleRecipeName(SYNTHETIC_TEMPLATE_COLOR), 'synthetic player'), `synthetic_woman_${pad}`],
    ] as const;
    for (const [template, name] of pair) {
      synthetic.push({ recipe: synthesizeRecipe(template, name, hue), template, hue });
    }
    return { player: color.id, male: pair[0][1], female: pair[1][1] };
  };
  const players = PLAYER_COLORS.map(playerRecipes);

  const recipes = sources.recipes.filter((r) => reached.has(r.name));
  const resolver = paletteResolver(sources);
  const ramps = new Map<string, string>();
  for (const recipe of recipes) {
    for (const patch of recipe.patches) {
      if (patch.source.kind !== 'ramp' || ramps.has(patch.source.ramp)) continue;
      ramps.set(patch.source.ramp, toHex(await resolver.ramp(patch.source.ramp, recipe.name)));
    }
  }
  for (const { template, hue } of synthetic) {
    for (const patch of template.patches) {
      if (patch.source.kind !== 'ramp') continue;
      const ramp = await resolver.ramp(patch.source.ramp, template.name);
      ramps.set(syntheticRampName(patch.source.ramp, hue), toHex(hueRotateRamp(ramp, hue)));
    }
  }

  const baseNames = new Set<string>();
  for (const look of sources.jobGraphics) {
    if (look.bodyPalette !== undefined) baseNames.add(look.bodyPalette);
    if (look.headPalette !== undefined) baseNames.add(look.headPalette);
  }
  const bases: Record<string, string> = {};
  for (const name of [...baseNames].sort()) bases[name] = toHex(await resolver.base(name));

  return {
    bases,
    ramps: Object.fromEntries([...ramps].sort(([a], [b]) => (a < b ? -1 : 1))),
    recipes: [...recipes, ...synthetic.map((s) => s.recipe)],
    players,
    armorRecipes,
    cartRecipes,
    jobChanges,
  };
}

/** Resolves `[GfxPalette256]` and `[GfxPalette16]` names to colours, reading each `.pcx` once. */
function paletteResolver(sources: HumanPaletteSources): {
  base: (name: string) => Promise<Uint8Array>;
  ramp: (name: string, recipe: string) => Promise<Uint8Array>;
} {
  const files = paletteAliasMap(extractPaletteIndex(sources.paletteSections));
  const rampAliases = rampAliasMap(sources.paletteSections);
  const loaded = new Map<string, Promise<Uint8Array>>();
  const base = (name: string): Promise<Uint8Array> => {
    const file = files.get(name);
    if (file === undefined) throw new Error(`human palettes: no [GfxPalette256] named "${name}"`);
    let palette = loaded.get(file);
    if (palette === undefined) {
      palette = sources.loadPalette(file);
      loaded.set(file, palette);
    }
    return palette;
  };
  const ramp = async (name: string, recipe: string): Promise<Uint8Array> => {
    const alias = rampAliases.get(name);
    if (alias === undefined)
      throw new Error(`human palettes: recipe "${recipe}" names unknown ramp "${name}"`);
    const colours = cutRamp(await base(alias.source), alias.range);
    if (colours === undefined) throw new Error(`human palettes: ramp "${name}" overruns its palette`);
    return colours;
  };
  return { base, ramp };
}

/**
 * The `humanPalettes` lane from the mod tree. A tree without `randompalette.ini` yields the empty lane,
 * the way an absent source contributes nothing elsewhere; a present one must resolve completely.
 */
export async function loadHumanPalettes(
  roots: SourceRoots,
  jobGraphics: readonly JobGraphics[],
  jobChanges: readonly JobChangeRecipes[],
): Promise<HumanPalettes> {
  if ((await resolveSourceFile(roots, RANDOMPALETTE_INI)) === undefined) return emptyHumanPalettes;
  return buildHumanPalettes({
    recipes: extractRandomPalettes(iniBytesToSections(await readSourceFile(roots, RANDOMPALETTE_INI))),
    paletteSections: iniBytesToSections(await readSourceFile(roots, PALETTES_INI)),
    jobGraphics,
    jobChanges,
    loadPalette: async (gfxFile) => {
      const palette = decodePcx(await readSourceFile(roots, gfxFile)).palette;
      if (palette === undefined) throw new Error(`human palettes: ${gfxFile} has no palette trailer`);
      assertPaletteBytes(palette, 'human palettes', gfxFile);
      return palette;
    },
  });
}
