import { Container, TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { createHumanPaletteIdentity } from '../../src/data/palettes/human-palettes.js';
import type { Viewport } from '../../src/data/projection/index.js';
import type { DrawItem } from '../../src/data/scene/index.js';
import type { ElevationField } from '../../src/data/terrain/index.js';
import { LayerBinder } from '../../src/gpu/sprite-pool/bind-layers.js';
import { humanPaletteIdentity } from '../../src/gpu/sprite-pool/human-palette-row.js';
import { SpritePool } from '../../src/gpu/sprite-pool/index.js';
import { resolveLayers } from '../../src/gpu/sprite-pool/resolve-layers.js';
import type { SettlerCharacter, SpriteSheet } from '../../src/gpu/sprite-sheet.js';
import { TextureCache } from '../../src/gpu/texture-cache.js';
import type { SpriteAtlas } from '../../src/index.js';
import { entity, snapshotOf } from '../support/fixtures.js';
import { syntheticHumanLut } from '../support/human-palettes.js';

/**
 * A cart its trader or carrier commander rides inside draws as the trader's driving figure, in the
 * character atlas, instead of its own sprite; any other commander, or a rider walking outside, leaves
 * the cart's sprite. The figure's sprite class is the settler palette's, so the binder asks for a new
 * pooled entity when a driver boards or steps off.
 */

const VIKING = 1;
const BYZANTINE = 3;
const HANDCART = 1;
const TRADER = 25;
const CARRIER = 24;
const WOMAN = 5;
const DRIVER = 8;
const CART_BOB = 3;
const STAND_BOB = 40;
const DRIVE_START = 100;
const DRIVE_STRIDE = 12;
const EAST = 4;
const source = new TextureSource({ width: 64, height: 64 });

const frame = { x: 0, y: 0, width: 8, height: 8, offsetX: -4, offsetY: -8 };
const cartAtlas: SpriteAtlas = { width: 8, height: 8, frames: new Map([[CART_BOB, frame]]) };
const humanAtlas: SpriteAtlas = {
  width: 8,
  height: 8,
  frames: new Map([
    [STAND_BOB, frame],
    [DRIVE_START + EAST * DRIVE_STRIDE + 2, frame],
  ]),
};
const lut = syntheticHumanLut();
const trader = {
  body: { source, atlas: humanAtlas },
  binding: {
    idle: 0,
    cartDrive: {
      [HANDCART]: { idle: STAND_BOB, moving: { start: DRIVE_START, dirs: 8, stride: DRIVE_STRIDE } },
    },
  },
};
const sheet: SpriteSheet = {
  source,
  atlas: { width: 0, height: 0, frames: new Map() },
  bindings: {
    settler: 0,
    building: 0,
    resource: 0,
    vehicle: {
      byTribe: { [VIKING]: { [HANDCART]: { layer: 'cart', idle: CART_BOB } } },
      fallbackTribe: VIKING,
    },
  },
  families: { cart: { source, atlas: cartAtlas } },
  characters: {
    byJob: { [TRADER]: trader },
    default: { body: { source, atlas: humanAtlas }, binding: { idle: 0 } },
  },
  palette: lut,
  cartDrive: {
    commanderJobs: new Set([CARRIER, TRADER]),
    lookJob: TRADER,
    cartRecipeByVehicleType: { [HANDCART]: 'handcart' },
  },
};

const cart = (driverJob?: number, state: DrawItem['state'] = 'idle'): DrawItem => ({
  kind: 'vehicle',
  ref: 7,
  x: 0,
  y: 0,
  depth: 0,
  tribe: VIKING,
  typeId: HANDCART,
  facing: EAST,
  state,
  ...(driverJob !== undefined ? { driver: { ref: DRIVER, jobType: driverJob, tribe: VIKING } } : {}),
});
const bodyFrameOf = (item: DrawItem, tick = 2) =>
  resolveLayers(sheet, item, tick)?.find((l) => l.shadow !== true && l.head !== true)?.frame;

describe('a cart driven from inside', () => {
  it('draws the trader standing with his cart, and driving it on the gait, for a carrier too', () => {
    expect(bodyFrameOf(cart(TRADER))).toBe(humanAtlas.frames.get(STAND_BOB));
    expect(bodyFrameOf(cart(CARRIER, 'moving'))).toBe(
      humanAtlas.frames.get(DRIVE_START + EAST * DRIVE_STRIDE + 2),
    );
  });

  it('keeps the cart sprite for another commander and for a cart nobody rides', () => {
    expect(bodyFrameOf(cart(WOMAN))).toBe(cartAtlas.frames.get(CART_BOB));
    expect(bodyFrameOf(cart())).toBe(cartAtlas.frames.get(CART_BOB));
  });

  it("draws a tribe's own cart driver when its trader body authors no driving gait", () => {
    const vikingHead = { ...frame, offsetX: -1 };
    const ownHead = { ...frame, offsetX: -2 };
    const headAtlas = (head: typeof frame): SpriteAtlas => ({
      width: 8,
      height: 8,
      frames: new Map([[STAND_BOB, head]]),
    });
    const onFoot = { body: { source, atlas: humanAtlas }, binding: { idle: 0 } };
    const tribeSheet = (cartDriver?: SettlerCharacter): SpriteSheet => ({
      ...sheet,
      characters: {
        byJob: { [TRADER]: { ...trader, heads: [{ source, atlas: headAtlas(vikingHead) }] } },
        default: onFoot,
        byTribe: {
          [BYZANTINE]: {
            byJob: { [TRADER]: { ...onFoot, ...(cartDriver !== undefined ? { cartDriver } : {}) } },
            default: onFoot,
          },
        },
      },
    });
    const driven: DrawItem = { ...cart(), driver: { ref: DRIVER, jobType: TRADER, tribe: BYZANTINE } };
    const headOf = (on: SpriteSheet) => resolveLayers(on, driven, 2)?.find((l) => l.head === true)?.frame;
    const ownPalette = { body: 'byz_body', head: 'byz_head', random: ['byz_roll'] };
    const own = tribeSheet({
      ...trader,
      palette: ownPalette,
      heads: [{ source, atlas: headAtlas(ownHead) }],
    });
    expect(headOf(own)).toBe(ownHead);
    expect(headOf(tribeSheet())).toBe(vikingHead);
    const identity = createHumanPaletteIdentity({ body: 'other', head: 'other', random: [] });
    expect(humanPaletteIdentity(own, driven, identity)).toBe(true);
    expect(identity).toMatchObject({ look: ownPalette, cart: 'handcart' });
  });

  it('turns the pooled cart into the settler palette class and back as its driver boards and steps off', () => {
    const binder = new LayerBinder(new TextureCache(), sheet);
    const parked = binder.create('vehicle', cart());
    expect(parked.paletted).toBe(false);
    expect(binder.suits(parked, cart(TRADER))).toBe(false);
    const driven = binder.create('vehicle', cart(TRADER));
    expect(driven.paletted && driven.palette).toBe(lut);
    expect(binder.suits(driven, cart(TRADER))).toBe(true);
    expect(binder.suits(driven, cart())).toBe(false);
  });

  it('swaps the pooled cart for one of the new class when its driver boards, keeping one on screen', () => {
    // The figure's frames are absent, so the driven cart binds the placeholder: the mesh needs a DOM.
    const faceless: SpriteSheet = {
      ...sheet,
      characters: {
        byJob: { [TRADER]: { ...trader, body: { source, atlas: { ...humanAtlas, frames: new Map() } } } },
        default: { body: { source, atlas: humanAtlas }, binding: { idle: 0 } },
      },
    };
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), faceless);
    const FLAT: ElevationField = { maxLift: 0, liftAt: () => 0, liftAtNode: () => 0 };
    const VIEW_ALL: Viewport = { minX: -1e6, maxX: 1e6, minY: -1e6, maxY: 1e6 };
    const frameOf = (inside: boolean, tick: number) => ({
      snapshot: snapshotOf(
        [
          entity(1, 3, 3, {
            Vehicle: { vehicleType: HANDCART, tribe: VIKING, facing: 0, passengers: [{ entity: 2, inside }] },
          }),
          { id: 2, components: { Settler: { jobType: TRADER, tribe: VIKING } } },
        ],
        tick,
      ),
      viewport: VIEW_ALL,
      tick,
      camera: { offsetX: 0, offsetY: 0 },
      screenW: 800,
      screenH: 600,
      elevation: FLAT,
      alpha: 1,
    });
    pool.reconcile(frameOf(false, 1));
    const [parked] = layer.children;
    pool.reconcile(frameOf(true, 2));
    expect(layer.children).toHaveLength(1);
    expect(layer.children[0]).not.toBe(parked);
    expect(parked?.destroyed).toBe(true);
    pool.reconcile(frameOf(true, 3));
    expect(layer.children).toHaveLength(1);
  });
});
