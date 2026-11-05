import { Texture, TextureSource } from 'pixi.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AtlasFrame } from '../../../../src/data/sprites/index.js';
import { LayerBinder } from '../../../../src/gpu/sprite-pool/bind-layers.js';
import type { ResolvedLayer } from '../../../../src/gpu/sprite-pool/layers/resolved-layer.js';
import * as alphaMask from '../../../../src/gpu/sprite-pool/picking/alpha-mask.js';
import { pixelHit, siteFlagHit } from '../../../../src/gpu/sprite-pool/picking/pick.js';
import { createPooled } from '../../../../src/gpu/sprite-pool/pooled-entity.js';
import { TextureCache } from '../../../../src/gpu/textures/texture-cache.js';
import { drawItem } from '../../../support/fixtures.js';

const FRAME: AtlasFrame = { x: 2, y: 2, width: 8, height: 8, offsetX: -4, offsetY: -8 };
const VIEW = { camera: { offsetX: 0, offsetY: 0 }, screenW: 800, screenH: 600 };
const cleanup: (() => void)[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const dispose of cleanup.splice(0)) dispose();
});

function fixture() {
  const page = new TextureSource({ width: 16, height: 16 });
  const cache = new TextureCache();
  const binder = new LayerBinder(cache, undefined);
  const pe = createPooled('building', undefined);
  pe.motion.drawX = 100;
  pe.motion.drawY = 200;
  const layer: ResolvedLayer = { source: page, frame: FRAME, scale: 2, reveal: 0.5 };
  const pixels = new Uint8Array(16 * 16 * 4).fill(255);
  vi.spyOn(alphaMask, 'alphaMaskOf').mockReturnValue(alphaMask.buildAlphaMask(pixels, 16, 16));
  cleanup.push(() => {
    pe.container.destroy({ children: true });
    cache.clear();
    page.destroy();
  });
  return { page, cache, binder, pe, layer };
}

describe('construction pixel picking', () => {
  it('rejects the unbuilt upper rows while keeping the visible foundation clickable at its drawn scale', () => {
    const { binder, pe, layer } = fixture();
    pe.reveal = 0.5;
    binder.bind(pe, drawItem('building', { builtPct: 50 }), [layer], VIEW, 1);
    expect(pixelHit(pe, 1, 101, 187)).toBe(false);
    expect(pixelHit(pe, 1, 101, 197)).toBe(true);
    expect(pixelHit(pe, 2, 101, 197)).toBeUndefined(); // a culled previous frame
  });

  it('picks a ship yard site on its cropped LUT quad the same way', () => {
    const { binder, pe: plain, layer } = fixture();
    const lut = { source: new TextureSource({ width: 256, height: 1 }), colours: 1 };
    const pe = createPooled('building', lut);
    pe.motion.drawX = plain.motion.drawX;
    pe.motion.drawY = plain.motion.drawY;
    cleanup.push(() => {
      pe.container.destroy({ children: true });
      lut.source.destroy();
    });
    pe.reveal = 0.5;
    binder.bind(pe, drawItem('building', { builtPct: 50 }), [layer], VIEW, 1);
    expect(pixelHit(pe, 1, 101, 187)).toBe(false);
    expect(pixelHit(pe, 1, 101, 197)).toBe(true);
  });

  it('does not restore the full box hit when every construction layer is still hidden', () => {
    const { binder, pe, layer } = fixture();
    pe.reveal = 0;
    binder.bind(pe, drawItem('building', { builtPct: 0 }), [layer], VIEW, 1);
    expect(pixelHit(pe, 1, 101, 187)).toBe(false);
    expect(pixelHit(pe, 1, 101, 197)).toBe(false);
    binder.bind(pe, drawItem('building', { builtPct: 0 }), null, VIEW, 2);
    expect(pixelHit(pe, 2, 101, 197)).toBeUndefined(); // visible fallback marker
  });

  it('uses the eased bound crop rather than newer simulation progress, even with unreadable pixels', () => {
    const { binder, pe, layer } = fixture();
    pe.reveal = 0.25;
    vi.spyOn(alphaMask, 'alphaMaskOf').mockReturnValue(null);
    binder.bind(pe, drawItem('building', { builtPct: 90 }), [layer], VIEW, 1);
    expect(pixelHit(pe, 1, 101, 187)).toBe(false);
    expect(pixelHit(pe, 1, 101, 197)).toBeUndefined();
  });

  it.each(['upgrade overlay', 'rebuild stack'] as const)(
    'picks the old body and revealed pixels of a %s, never the future roof or cast shadow',
    (mode) => {
      const { binder, cache, pe, page, layer } = fixture();
      // A revealed frame with one isolated roof pixel; every other roof texel is still hidden.
      const revealedSource = new TextureSource({ width: 8, height: 8 });
      const revealed = new Texture({ source: revealedSource });
      cleanup.push(() => revealed.destroy(true));
      const pixels = new Uint8Array(8 * 8 * 4);
      pixels[(1 * 8 + 4) * 4 + 3] = 255;
      const revealedMask = alphaMask.buildAlphaMask(pixels, 8, 8);
      const solid = alphaMask.buildAlphaMask(new Uint8Array(16 * 16 * 4).fill(255), 16, 16);
      vi.spyOn(alphaMask, 'alphaMaskOf').mockImplementation((source) =>
        source === page ? solid : source === revealedSource ? revealedMask : null,
      );
      vi.spyOn(cache, 'revealed').mockReturnValue(revealed);
      const oldBody: ResolvedLayer = {
        source: page,
        frame: { ...FRAME, width: 4, height: 2, offsetX: -2, offsetY: -2 },
        scale: 2,
        ...(mode === 'rebuild stack' ? { fadeOutFromPct: 85 } : {}),
      };
      const nextBody: ResolvedLayer = {
        ...layer,
        times: { width: 16, height: 16, values: new Uint8Array(16 * 16) },
        revealWindow: [0, 100],
      };
      const shadow: ResolvedLayer = { ...layer, shadow: true, boundsExempt: true };
      const work: ResolvedLayer = {
        ...layer,
        frame: { ...FRAME, width: 2, height: 2, offsetX: -6, offsetY: -2 },
      };
      const layers =
        mode === 'rebuild stack' ? [shadow, oldBody, work, nextBody] : [shadow, oldBody, nextBody];
      pe.reveal = 0.5;
      binder.bind(pe, drawItem('building', { upgradePct: 90 }), layers, VIEW, 1);
      expect(pixelHit(pe, 1, 101, 187)).toBe(true); // isolated revealed roof pixel
      expect(pixelHit(pe, 1, 103, 187)).toBe(false); // its still-hidden neighbour
      expect(pixelHit(pe, 1, 101, 197)).toBe(true); // retained old body
      expect(pixelHit(pe, 1, 107, 197)).toBe(false); // only the shadow covers this point
      if (mode === 'rebuild stack') {
        expect(pixelHit(pe, 1, 89, 199)).toBe(true); // visible scaffold beside the old body
        pe.reveal = 1;
        binder.bind(pe, drawItem('building', { upgradePct: 99 }), layers, VIEW, 2);
        expect(pixelHit(pe, 2, 101, 197)).toBe(false); // old body faded out completely
      }
    },
  );
});

describe('claimed site flag picking', () => {
  it.each(['roadsite', 'palisade'] as const)(
    "answers on a claimed %s's flag pixels only, never on the open site or a culled frame",
    (kind) => {
      const { binder, pe, layer } = fixture();
      const claimed =
        kind === 'roadsite' ? { roadSite: 'claimed' as const } : { palisadeSite: 'claimed' as const };
      const open =
        kind === 'roadsite' ? { roadSite: 'unclaimed' as const } : { palisadeSite: 'unclaimed' as const };
      binder.bind(pe, drawItem(kind, claimed), [layer], VIEW, 1);
      expect(siteFlagHit(pe, 1, 101, 197)).toBe(true); // on the flag
      expect(siteFlagHit(pe, 1, 120, 197)).toBe(false); // beside it, on the ring or plot
      expect(pixelHit(pe, 1, 101, 197)).toBeUndefined(); // the site itself keeps its box
      expect(siteFlagHit(pe, 2, 101, 197)).toBe(false);
      binder.bind(pe, drawItem(kind, open), [layer], VIEW, 3);
      expect(siteFlagHit(pe, 3, 101, 197)).toBe(false);
    },
  );
});
