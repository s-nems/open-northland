import { describe, expect, it } from 'vitest';
import { createHumanPaletteIdentity } from '../../src/data/palettes/human-palettes.js';
import type { DrawItem } from '../../src/data/scene/index.js';
import {
  humanLayerRow,
  humanLutRow,
  humanPaletteIdentity,
} from '../../src/gpu/sprite-pool/human-palette-row.js';
import type { SettlerCharacterSet, SpriteSheet } from '../../src/gpu/sprite-sheet.js';
import { vehicleLutRow } from '../../src/gpu/sprite-sheet.js';
import { syntheticHumanLut } from '../support/human-palettes.js';

const CHAIN_MAIL = 35;
const CHAIN_TIER = 3;
const HERO_JOB = 43;
const OWNER = 2;

const look = { body: 'body', head: 'head', random: ['roll'] };
const item: DrawItem = {
  kind: 'settler',
  ref: 9,
  x: 0,
  y: 0,
  depth: 0,
  player: OWNER,
  jobType: HERO_JOB,
  armorGood: CHAIN_MAIL,
};

function sheetWith(characters: SettlerCharacterSet): SpriteSheet {
  return {
    source: {} as SpriteSheet['source'],
    atlas: { width: 0, height: 0, frames: new Map() },
    bindings: { settler: 0, building: 0, resource: 0 },
    characters,
    palette: syntheticHumanLut(new Map([[CHAIN_MAIL, CHAIN_TIER]])),
  };
}

const plain = { byJob: {}, default: { palette: look } } as unknown as SettlerCharacterSet;
const heroes = {
  byJob: {},
  fixedByJob: { [HERO_JOB]: { palette: look } },
  default: { palette: look },
} as unknown as SettlerCharacterSet;

describe('a settler palette identity', () => {
  it('reads the look, owner, sex, stable seed and worn armor tier off the item', () => {
    const out = createHumanPaletteIdentity(look);
    expect(humanPaletteIdentity(sheetWith(plain), { ...item, female: true }, out)).toBe(true);
    expect(out).toMatchObject({ look, player: OWNER, female: true, seed: item.ref, armorTier: CHAIN_TIER });
  });

  it('keeps a fixed hero character out of the armor recipes despite its mechanical armor', () => {
    const out = createHumanPaletteIdentity(look);
    humanPaletteIdentity(sheetWith(heroes), item, out);
    expect(out.armorTier).toBeUndefined();
  });

  it('draws a baked look without the human LUT', () => {
    const baked = { byJob: {}, default: { indexed: false } } as unknown as SettlerCharacterSet;
    expect(humanPaletteIdentity(sheetWith(baked), item, createHumanPaletteIdentity(look))).toBe(false);
  });
});

describe('a driven cart palette identity', () => {
  const HANDCART = 1;
  const TRADER = 25;
  const VIKING = 1;
  const RIDER = 40;
  const CART = 41;
  const traderLook = { body: 'trader', head: 'trader', random: [] };
  const trader = {
    palette: traderLook,
    binding: { idle: 0, cartDrive: { [HANDCART]: { idle: 3, moving: { start: 3, dirs: 8, stride: 1 } } } },
  };
  const sheet: SpriteSheet = {
    ...sheetWith({
      byJob: { [TRADER]: trader },
      default: { palette: look },
    } as unknown as SettlerCharacterSet),
    cartDrive: {
      commanderJobs: new Set([TRADER]),
      lookJob: TRADER,
      cartRecipeByVehicleType: { [HANDCART]: 'handcart' },
    },
  };
  const cart: DrawItem = {
    kind: 'vehicle',
    ref: CART,
    x: 0,
    y: 0,
    depth: 0,
    typeId: HANDCART,
    player: OWNER,
    driver: { ref: RIDER, jobType: TRADER, tribe: VIKING, female: true },
  };

  it("rolls from the rider's own seed and sex, in the trader look, with the cart recipe on top", () => {
    const out = createHumanPaletteIdentity(look);
    expect(humanPaletteIdentity(sheet, cart, out)).toBe(true);
    expect(out).toMatchObject({
      look: traderLook,
      player: OWNER,
      female: true,
      seed: RIDER,
      cart: 'handcart',
      armorTier: undefined,
    });
  });

  it('keys its LUT row by the cart, apart from the rider', () => {
    const lut = sheet.palette;
    if (lut === undefined) throw new Error('the sheet carries a LUT');
    lut.beginFrame();
    const row = humanLutRow(sheet, cart);
    const out = createHumanPaletteIdentity(look);
    humanPaletteIdentity(sheet, cart, out);
    expect(lut.rowFor(CART, out)).toBe(row);
    expect(lut.stats.composed).toBe(1);
  });
});

describe('humanLayerRow', () => {
  it("sends a head overlay to the row under its human's body row", () => {
    expect(humanLayerRow({ head: true }, 6)).toBe(7);
    expect(humanLayerRow({}, 6)).toBe(6);
  });
});

describe('vehicleLutRow', () => {
  const SHIP_PALETTES = 10;
  const lut = { source: {} as SpriteSheet['source'], colours: SHIP_PALETTES };

  it("reads the owner's row, the first for an unowned vehicle, and wraps past the family", () => {
    expect(vehicleLutRow(lut, 3)).toBe(3);
    expect(vehicleLutRow(lut, undefined)).toBe(0);
    expect(vehicleLutRow(lut, SHIP_PALETTES + 2)).toBe(2);
  });
});
