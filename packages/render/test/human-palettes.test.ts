import type { RandomPaletteRecipe } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  type CharacterPalette,
  createHumanPaletteColours,
  createHumanPaletteIdentity,
  HumanPaletteBook,
  type HumanPaletteColours,
  type HumanPaletteIdentity,
} from '../src/data/palettes/human-palettes.js';
import { flatRamp, syntheticLane, TEST_BASE } from './support/human-palettes.js';

/**
 * A human's palettes compose from its look's bases, then its player recipe by sex, one recipe rolled
 * from the look's list, the job-change recipe, the worn armor's and the cart's. Each recipe rolls one line
 * per band id by weight; ids 16..31 address the head palette.
 */

const BAND_BYTES = 48;
const TEAM = 15;
const APRON = 14;
const SHIRT = 1;
const HAIR = 20;
const EYEBROWS = 21;
const HEAD_HAIR_BAND = HAIR - 16;
const HEAD_EYEBROW_BAND = EYEBROWS - 16;

const RED = [255, 0, 0];
const BLUE = [0, 0, 255];
const BROWN = [120, 60, 10];
const GOLD = [230, 200, 40];
const MAIL = [90, 90, 100];
const WOOD = [150, 100, 50];

const ramps = {
  red: flatRamp(255, 0, 0),
  blue: flatRamp(0, 0, 255),
  brown: flatRamp(120, 60, 10),
  gold: flatRamp(230, 200, 40),
  mail: flatRamp(90, 90, 100),
  wood: flatRamp(150, 100, 50),
};

const ramp = (band: number, name: string, weight = 1) => ({
  band,
  source: { kind: 'ramp' as const, ramp: name },
  weight,
});
const copy = (band: number, from: number, weight = 1) => ({
  band,
  source: { kind: 'copy' as const, band: from },
  weight,
});

const PLAYER_RECIPES: RandomPaletteRecipe[] = [
  { name: 'player_00', patches: [ramp(TEAM, 'red')] },
  { name: 'woman_00', patches: [ramp(TEAM, 'blue')] },
];

function book(recipes: RandomPaletteRecipe[], extra = {}): HumanPaletteBook {
  return new HumanPaletteBook(syntheticLane(ramps, [...PLAYER_RECIPES, ...recipes], extra), TEST_BASE);
}

function identity(look: CharacterPalette, fields: Partial<HumanPaletteIdentity> = {}): HumanPaletteIdentity {
  return Object.assign(createHumanPaletteIdentity(look), fields);
}

function compose(b: HumanPaletteBook, id: HumanPaletteIdentity): HumanPaletteColours {
  const out = createHumanPaletteColours();
  b.compose(id, out);
  return out;
}

/** Every colour of one band, which a flat ramp makes all alike: the first one. */
function band(palette: Uint8Array, id: number): number[] {
  const at = id * BAND_BYTES;
  return [palette[at] ?? -1, palette[at + 1] ?? -1, palette[at + 2] ?? -1];
}

/** The grey base's colour for palette index `index`. */
const grey = (index: number) => [index, index, index];

const PLAIN: CharacterPalette = { body: TEST_BASE, head: TEST_BASE, random: [] };

describe('composing a human palette', () => {
  it('applies the player recipe by sex: player_NN for a man, woman_NN for a woman or girl', () => {
    const b = book([]);
    expect(band(compose(b, identity(PLAIN)).body, TEAM)).toEqual(RED);
    expect(band(compose(b, identity(PLAIN, { female: true })).body, TEAM)).toEqual(BLUE);
  });

  it('starts from the look bases and falls back to the fallback base for an unknown one', () => {
    const out = compose(book([]), identity({ body: 'unknown', head: 'unknown', random: [] }));
    expect(band(out.body, SHIRT)).toEqual(grey(SHIRT * 16));
    expect(band(out.head, SHIRT)).toEqual(grey(SHIRT * 16));
  });

  it('sends band ids 16..31 to the head palette and leaves the body band of the same number alone', () => {
    const b = book([{ name: 'hair', patches: [ramp(HAIR, 'gold')] }]);
    const out = compose(b, identity({ ...PLAIN, random: ['hair'] }));
    expect(band(out.head, HEAD_HAIR_BAND)).toEqual(GOLD);
    expect(band(out.body, HEAD_HAIR_BAND)).toEqual(grey(HEAD_HAIR_BAND * 16));
  });

  it('copies a band as composed so far, so eyebrows follow the hair rolled before them', () => {
    const b = book([{ name: 'base', patches: [ramp(HAIR, 'gold'), copy(EYEBROWS, HAIR)] }]);
    const out = compose(b, identity({ ...PLAIN, random: ['base'] }));
    expect(band(out.head, HEAD_EYEBROW_BAND)).toEqual(GOLD);
  });

  it("gives a woman's furniture band her team colour or her shirt's, as the weights say", () => {
    const team = book([{ name: 'woman_base', patches: [copy(APRON, TEAM, 1), copy(APRON, SHIRT, 0)] }]);
    const shirt = book([{ name: 'woman_base', patches: [copy(APRON, TEAM, 0), copy(APRON, SHIRT, 1)] }]);
    const woman = identity({ ...PLAIN, random: ['woman_base'] }, { female: true });
    expect(band(compose(team, woman).body, APRON)).toEqual(BLUE);
    expect(band(compose(shirt, woman).body, APRON)).toEqual(grey(SHIRT * 16));
  });

  it('never applies a band whose weights sum to zero', () => {
    const b = book([{ name: 'none', patches: [ramp(SHIRT, 'brown', 0)] }]);
    expect(band(compose(b, identity({ ...PLAIN, random: ['none'] })).body, SHIRT)).toEqual(grey(SHIRT * 16));
  });

  it('lays the job change, then the armor, then the cart over the rolled recipe', () => {
    const b = book(
      [
        { name: 'cloth', patches: [ramp(SHIRT, 'brown')] },
        { name: 'change', patches: [ramp(SHIRT, 'gold')] },
        { name: 'human_armor_002', patches: [ramp(SHIRT, 'mail')] },
        { name: 'good_handcart', patches: [ramp(SHIRT, 'wood')] },
      ],
      {
        armorRecipes: ['human_armor_000', 'human_armor_001', 'human_armor_002'],
        cartRecipes: { handcart: 'good_handcart', oxcart: 'good_oxcart' },
      },
    );
    const look = { ...PLAIN, random: ['cloth'] };
    expect(band(compose(b, identity(look)).body, SHIRT)).toEqual(BROWN);
    expect(band(compose(b, identity(look, { jobChange: 'change' })).body, SHIRT)).toEqual(GOLD);
    expect(band(compose(b, identity(look, { jobChange: 'change', armorTier: 2 })).body, SHIRT)).toEqual(MAIL);
    expect(
      band(compose(b, identity(look, { jobChange: 'change', armorTier: 2, cart: 'handcart' })).body, SHIRT),
    ).toEqual(WOOD);
  });

  it('looks up the job-change recipe by tribe and job, else up the base-job chain', () => {
    const CIVILIST = 6;
    const BUILDER = 7;
    const MASTER_BUILDER = 70;
    const lane = syntheticLane(ramps, PLAYER_RECIPES, {
      jobChanges: [{ tribe: 1, job: CIVILIST, recipe: 'change' }],
    });
    const parents = new Map([
      [BUILDER, CIVILIST],
      [MASTER_BUILDER, BUILDER],
    ]);
    const b = new HumanPaletteBook(lane, TEST_BASE, parents);
    expect(b.jobChangeRecipe(1, CIVILIST)).toBe('change');
    expect(b.jobChangeRecipe(1, MASTER_BUILDER)).toBe('change');
    expect(b.jobChangeRecipe(2, BUILDER)).toBeUndefined();
    expect(b.jobChangeRecipe(undefined, BUILDER)).toBeUndefined();
  });

  it('stops at a job change record of its own that names no recipe, never reaching the parent', () => {
    const CIVILIST = 6;
    const DRUID = 30;
    const lane = syntheticLane(ramps, PLAYER_RECIPES, {
      jobChanges: [
        { tribe: 1, job: CIVILIST, recipe: 'change' },
        { tribe: 1, job: DRUID },
      ],
    });
    const b = new HumanPaletteBook(lane, TEST_BASE, new Map([[DRUID, CIVILIST]]));
    expect(b.jobChangeRecipe(1, DRUID)).toBeUndefined();
  });

  it('rolls per human: the same seed repeats, other seeds reach every weighted line', () => {
    const b = book([
      {
        name: 'hair',
        patches: [ramp(HAIR, 'gold'), ramp(HAIR, 'brown'), ramp(SHIRT, 'red'), ramp(SHIRT, 'blue')],
      },
    ]);
    const look = { ...PLAIN, random: ['hair'] };
    const seen = new Set<string>();
    for (let seed = 0; seed < 64; seed++) {
      const out = compose(b, identity(look, { seed }));
      expect(compose(b, identity(look, { seed }))).toEqual(out);
      seen.add(`${band(out.head, HEAD_HAIR_BAND)}/${band(out.body, SHIRT)}`);
    }
    expect(seen.size).toBe(4);
  });

  it('keeps what a human rolled when armor or a cart goes on, since each stage rolls on its own', () => {
    const b = book(
      [
        { name: 'hair', patches: [ramp(HAIR, 'gold'), ramp(HAIR, 'brown')] },
        { name: 'human_armor_001', patches: [ramp(SHIRT, 'mail'), ramp(SHIRT, 'wood')] },
      ],
      { armorRecipes: ['human_armor_000', 'human_armor_001'] },
    );
    const look = { ...PLAIN, random: ['hair'] };
    for (let seed = 0; seed < 16; seed++) {
      const bare = compose(b, identity(look, { seed }));
      const armored = compose(b, identity(look, { seed, armorTier: 1 }));
      expect(band(armored.head, HEAD_HAIR_BAND)).toEqual(band(bare.head, HEAD_HAIR_BAND));
    }
  });

  it('picks one of the look recipes per human', () => {
    const b = book([
      { name: 'gold_hair', patches: [ramp(HAIR, 'gold')] },
      { name: 'brown_hair', patches: [ramp(HAIR, 'brown')] },
    ]);
    const look = { ...PLAIN, random: ['gold_hair', 'brown_hair'] };
    const seen = new Set<string>();
    for (let seed = 0; seed < 32; seed++) {
      seen.add(String(band(compose(b, identity(look, { seed })).head, HEAD_HAIR_BAND)));
    }
    expect(seen).toEqual(new Set([String(GOLD), String(BROWN)]));
  });

  it('counts a look recipe the lane lacks as an option that changes nothing', () => {
    const b = book([{ name: 'gold_hair', patches: [ramp(HAIR, 'gold')] }]);
    const look = { ...PLAIN, random: ['gold_hair', 'absent'] };
    const seen = new Set<string>();
    for (let seed = 0; seed < 32; seed++) {
      seen.add(String(band(compose(b, identity(look, { seed })).head, HEAD_HAIR_BAND)));
    }
    expect(seen).toEqual(new Set([String(GOLD), String(grey(HEAD_HAIR_BAND * 16))]));
  });

  describe('a carried good', () => {
    const WHEAT = 4;
    const STONE = 3;
    const FURNITURE = 29;
    const DRESS = TEAM;
    const MAN_TEAM = 10;
    const goodBook = (extra = {}) =>
      new HumanPaletteBook(
        syntheticLane(
          ramps,
          [
            { name: 'player_00', patches: [ramp(MAN_TEAM, 'red')] },
            { name: 'woman_00', patches: [ramp(DRESS, 'blue')] },
            { name: 'good_wheat', patches: [ramp(APRON, 'gold'), ramp(DRESS, 'gold')] },
            { name: 'good_furniture', patches: [ramp(APRON, 'brown'), ramp(DRESS, 'brown')] },
            { name: 'human_armor_001', patches: [ramp(APRON, 'mail')] },
            { name: 'good_handcart', patches: [ramp(APRON, 'wood')] },
          ],
          {
            goodRecipes: [
              { good: WHEAT, recipe: 'good_wheat' },
              { good: FURNITURE, recipe: 'good_furniture' },
            ],
            armorRecipes: ['human_armor_000', 'human_armor_001'],
            cartRecipes: { handcart: 'good_handcart', oxcart: 'good_oxcart' },
            ...extra,
          },
        ),
        TEST_BASE,
      );

    it("colours a man's load wholly by the good's recipe", () => {
      const out = compose(goodBook(), identity(PLAIN, { carried: WHEAT }));
      expect(band(out.body, APRON)).toEqual(GOLD);
      expect(band(out.body, DRESS)).toEqual(GOLD);
      expect(band(out.body, MAN_TEAM)).toEqual(RED);
    });

    it("keeps a woman's team-coloured dress and gives only the band her load shares the good's colour", () => {
      const out = compose(goodBook(), identity(PLAIN, { carried: FURNITURE, female: true }));
      expect(band(out.body, DRESS)).toEqual(BLUE);
      expect(band(out.body, APRON)).toEqual(BROWN);
    });

    it('leaves a good without a recipe in the human palette as it is', () => {
      const b = goodBook();
      expect(compose(b, identity(PLAIN, { carried: STONE }))).toEqual(compose(b, identity(PLAIN)));
    });

    it('goes on after the armor and the cart', () => {
      const out = compose(goodBook(), identity(PLAIN, { carried: WHEAT, armorTier: 1, cart: 'handcart' }));
      expect(band(out.body, APRON)).toEqual(GOLD);
      expect(band(compose(goodBook(), identity(PLAIN, { armorTier: 1 })).body, APRON)).toEqual(MAIL);
    });
  });
});
