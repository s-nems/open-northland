import { Rectangle, Texture, TextureSource } from 'pixi.js';
import { afterEach, expect, it } from 'vitest';
import type { DrawItem } from '../src/data/scene/index.js';
import { collapsePlan } from '../src/gpu/overlays/collapse-plan.js';
import { resolveLayers } from '../src/gpu/sprite-pool/resolve-layers.js';
import type { ResolvedLayer } from '../src/gpu/sprite-pool/resolved-layer.js';
import type { SpriteSheet } from '../src/gpu/sprite-sheet.js';

const sources: TextureSource[] = [];
afterEach(() => {
  for (const source of sources.splice(0)) source.destroy();
});

function fixture() {
  const source = new TextureSource({ width: 60, height: 20 });
  sources.push(source);
  const frame = (x: number) => ({ x, y: 0, width: 20, height: 20, offsetX: -10, offsetY: -20 });
  const sheet: SpriteSheet = {
    source,
    atlas: { width: 60, height: 20, frames: new Map() },
    bindings: {
      settler: 1,
      resource: 1,
      building: {
        default: 1,
        byType: { 1: { layer: 'house', bob: 3 } },
        constructionByType: {
          1: [
            { layer: 'house', bob: 1, fromPct: 0, toPct: 70 },
            { layer: 'house', bob: 2, fromPct: 0, toPct: 100 },
            { layer: 'house', bob: 3, fromPct: 20, toPct: 100 },
          ],
        },
      },
    },
    families: {
      house: {
        source,
        atlas: {
          width: 60,
          height: 20,
          frames: new Map([
            [1, frame(0)],
            [2, frame(20)],
            [3, frame(40)],
          ]),
        },
        times: { width: 60, height: 20, values: new Uint8Array(60 * 20) },
      },
    },
  };
  const item: DrawItem = { kind: 'building', typeId: 1, ref: 1, tribe: 1, x: 0, y: 0, depth: 0 };
  const body = resolveLayers(sheet, item, 0)?.find(
    (layer) => layer.shadow !== true && layer.groundFoot !== 'cover',
  );
  if (body === undefined) throw new Error('Missing finished body');
  return { sheet, item, body };
}

it('unwinds damaged pixels over their own backing, in construction order and original coordinates', () => {
  const { sheet, item, body } = fixture();
  const leased = new Texture({ source: body.source, frame: new Rectangle(4, 3, 20, 20) });
  const plan = collapsePlan(sheet, item, [
    {
      texture: leased,
      x: -10,
      y: -20,
      scale: 1,
      alpha: 0.8,
      layer: body,
      damageLevel: 6,
      release() {},
    },
  ]);
  expect(plan).toHaveLength(3);
  expect(plan.map((part) => part.construction.frame.x)).toEqual([0, 20, 40]);
  expect(plan.map((part) => part.introduced)).toEqual([true, true, false]);
  expect(plan[2]?.draw.frame).toMatchObject({ x: 4, y: 3, offsetX: -10, offsetY: -20 });
  expect(plan[2]?.construction.times).toBe(body.times);
  expect(plan[2]?.construction.revealWindow).toEqual([20, 100]);
  expect(plan[2]?.alpha).toBe(0.8);
  expect(plan[0]?.shade).toBeLessThan(0.8);
  leased.destroy();
});

it('never introduces complete construction art into a partial site or an upgrading stack', () => {
  const { sheet, item, body } = fixture();
  const partial = collapsePlan(sheet, { ...item, builtPct: 35 }, undefined);
  expect(partial).toHaveLength(3);
  expect(partial.every((part) => !part.introduced && part.draw.reveal === 0.35)).toBe(true);
  const leased = new Texture({ source: body.source });
  const upgrade: ResolvedLayer = { ...body, reveal: 0.42, revealWindow: [0, 100] };
  const plan = collapsePlan(sheet, item, [
    {
      texture: leased,
      x: -10,
      y: -20,
      scale: 1,
      alpha: 1,
      layer: upgrade,
      release() {},
    },
  ]);
  expect(plan).toHaveLength(1);
  expect(plan[0]?.introduced).toBe(false);
  expect(plan[0]?.construction.reveal).toBe(0.42);
  // A live upgrade's window must survive even if it shares a frame with a from-scratch stage.
  expect(plan[0]?.construction.revealWindow).toEqual([0, 100]);
  leased.destroy();
});

it('does not mix construction frames into replacement art without a matching finished body', () => {
  const { sheet, item } = fixture();
  const family = sheet.families?.house;
  const binding = sheet.bindings.building;
  if (family === undefined || typeof binding === 'number') throw new Error('Missing construction fixture');
  const replacement = new TextureSource({ width: 60, height: 20 });
  sources.push(replacement);
  const different = {
    ...sheet,
    families: { ...sheet.families, replacement: { ...family, source: replacement } },
    bindings: {
      ...sheet.bindings,
      building: { ...binding, byType: { 1: { layer: 'replacement', bob: 3 } } },
    },
  };
  const plan = collapsePlan(different, item, undefined);
  expect(plan).toHaveLength(1);
  expect(plan[0]?.draw.source).toBe(replacement);
  expect(plan[0]?.introduced).toBe(false);
});

it('exposes the same backing as damage cavities, excluding another finished tier in the stage stack', () => {
  const { sheet, item } = fixture();
  const binding = sheet.bindings.building;
  if (typeof binding === 'number') throw new Error('Missing construction fixture');
  const tiers = {
    ...sheet,
    bindings: {
      ...sheet.bindings,
      building: {
        ...binding,
        byType: { ...binding.byType, 2: { layer: 'house', bob: 2 } },
      },
    },
  };
  const plan = collapsePlan(tiers, item, undefined);
  expect(plan.map((part) => part.construction.frame.x)).toEqual([0, 40]);
  expect(plan.map((part) => part.introduced)).toEqual([true, false]);
});
