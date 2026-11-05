import { Texture, TextureSource } from 'pixi.js';
import { expect, it, vi } from 'vitest';
import { PalettedSprite } from '../../../src/gpu/paletted-sprite/index.js';
import { OutlineSprite, SelectionSprite } from '../../../src/gpu/selection/sprite-effect.js';
import { LIFT_TONE_CODE, targetFlashLight } from '../../../src/gpu/selection/style.js';
import { createPooled } from '../../../src/gpu/sprite-pool/pooled-entity.js';
import { SelectionEffects } from '../../../src/gpu/sprite-pool/selection-effects.js';
import { TextureCache } from '../../../src/gpu/textures/texture-cache.js';
import { SELECTION_TONE_BAND } from '../../../src/gpu/world-batch/shader.js';
import { syntheticHumanLut } from '../../support/human-palettes.js';
import { useHeadlessShaderContext } from '../../support/shader-context.js';

it('outlines the visible body, excludes shadows, and releases the outline when the style changes', () => {
  const textures = new TextureCache();
  const effects = new SelectionEffects(textures);
  const pe = createPooled('building', undefined);
  if (pe.paletted) throw new Error('Expected a plain building');
  const body = new SelectionSprite(Texture.WHITE);
  body.position.set(12, -30);
  body.scale.set(2);
  const shadow = new SelectionSprite(Texture.WHITE);
  pe.sprites.push(shadow, body);
  pe.pickExempt.push(true, false);
  pe.container.addChild(shadow, body);
  effects.update(pe, 'outline', 1, 0);
  const outline = pe.container.children[0];
  // One quad per pass over the one visible body, the dark keyline under the ivory core.
  expect(outline?.children).toHaveLength(2);
  const dark = outline?.children[0];
  const ivory = outline?.children[1];
  if (!(dark instanceof OutlineSprite) || !(ivory instanceof OutlineSprite))
    throw new Error('Missing outline');
  expect(dark.tint).toBe(0x14211b);
  expect(ivory.tint).toBe(0xf2e8c9);
  expect(dark.bodyTexture).toBe(Texture.WHITE);
  // A body texel spans 2 units, so a reach of 2 grows the quad by one texel on every side.
  expect([dark.texture.frame.x, dark.texture.frame.width]).toEqual([-1, 3]);
  expect(dark.position.x).toBeCloseTo(10);
  expect(dark.position.y).toBeCloseTo(-32);
  expect(dark.scale.x).toBe(2);
  expect(Array.from(dark.reachUv, (v) => v + 0)).toEqual([1, 0, 0, 1]);
  expect(Array.from(ivory.reachUv, (v) => v + 0)).toEqual([0.625, 0, 0, 0.625]);
  effects.update(pe, 'outline', 2, 0);
  expect(pe.container.children[0]).toBe(outline);
  expect(Array.from(dark.reachUv, (v) => v + 0)).toEqual([0.5, 0, 0, 0.5]);
  // Hidden for an inset by alpha, so the band's structure (and its instructions) stays as it was.
  effects.setVisible(false);
  expect(outline?.visible).toBe(true);
  expect(outline?.alpha).toBe(0);
  effects.setVisible(true);
  expect(outline?.alpha).toBe(1);
  effects.update(pe, 'pulse', 2, 0.45);
  expect(outline?.destroyed).toBe(true);
  expect(shadow.selectionEffect).toBe(0);
  expect(body.selectionEffect).toBeCloseTo(0.095);
  effects.setVisible(false);
  expect(body.selectionEffect).toBe(0);
  effects.setVisible(true);
  expect(body.selectionEffect).toBeCloseTo(0.095);
  effects.update(pe, 'pulse', 2, 1.35);
  expect(body.selectionEffect).toBeCloseTo(0.045);
  effects.clear(pe);
  expect(body.selectionEffect).toBe(0);
  expect(pe.container.children).toEqual([shadow, body]);
  pe.container.destroy({ children: true });
  textures.clear();
});

/** A flash at its midpoint, where it lifts the most. */
const PEAK = 0.5;

it("packs a target flash's tone into the batch value, over the selection pulse, until it has played out", () => {
  const effects = new SelectionEffects(new TextureCache());
  const pe = createPooled('building', undefined);
  if (pe.paletted) throw new Error('Expected a plain building');
  const body = new SelectionSprite(Texture.WHITE);
  pe.sprites.push(body);
  pe.pickExempt.push(false);
  pe.container.addChild(body);
  const peak = targetFlashLight(PEAK);
  for (const tone of ['order', 'attack', 'assign'] as const) {
    effects.update(pe, 'pulse', 1, 0, undefined, { tone, progress: PEAK });
    expect(body.selectionEffect).toBeCloseTo(LIFT_TONE_CODE[tone] * SELECTION_TONE_BAND + peak);
  }
  // Played out, the selected body falls back to its white pulse; unselected, it goes unlit.
  effects.update(pe, 'pulse', 1, 0);
  expect(body.selectionEffect).toBeCloseTo(0.07);
  effects.update(pe, undefined, 1, 0, undefined, { tone: 'attack', progress: PEAK });
  effects.update(pe, undefined, 1, 0);
  expect(body.selectionEffect).toBe(0);
  pe.container.destroy({ children: true });
});

useHeadlessShaderContext();

it("hands a paletted body a flash's amount and tone apart", () => {
  const effects = new SelectionEffects(new TextureCache());
  const lut = syntheticHumanLut();
  const pe = createPooled('vehicle', lut);
  if (!pe.paletted) throw new Error('Expected an indexed vehicle');
  const body = new PalettedSprite(lut.source, lut.colours);
  const light = vi.spyOn(body, 'setSelectionLight');
  pe.sprites.push(body);
  pe.container.addChild(body);
  effects.update(pe, undefined, 1, 0, undefined, { tone: 'attack', progress: PEAK });
  expect(light).toHaveBeenLastCalledWith(expect.closeTo(targetFlashLight(PEAK)), LIFT_TONE_CODE.attack);
  effects.update(pe, undefined, 1, 0);
  expect(light).toHaveBeenLastCalledWith(0, 0);
  pe.container.destroy({ children: true });
  lut.source.destroy();
});

it('fades the old building tier outline with its body and resets opacity when quads are reused', () => {
  const textures = new TextureCache();
  const effects = new SelectionEffects(textures);
  const pe = createPooled('building', undefined);
  if (pe.paletted) throw new Error('Expected a plain building');
  const body = new SelectionSprite(Texture.WHITE);
  pe.sprites.push(body);
  pe.pickExempt.push(false);
  pe.container.addChild(body);
  effects.update(pe, 'outline', 1, 0);
  const outline = pe.container.children[0];
  if (outline === undefined) throw new Error('Missing outline');
  expect(outline.children).toHaveLength(2);
  for (const alpha of [0.5, 0.1, 0, 1]) {
    body.alpha = alpha;
    effects.update(pe, 'outline', 1, 0);
    expect(pe.container.children[0]).toBe(outline);
    // A stamp leaves the picture at zero alpha, never by a visibility flip.
    expect(outline.children.every((stamp) => stamp.visible)).toBe(true);
    const shown = outline.children.filter((stamp) => stamp.alpha > 0);
    expect(shown).toHaveLength(alpha === 0 ? 0 : 2);
    for (const stamp of shown) expect(stamp.alpha).toBe(alpha);
  }
  effects.clear(pe);
  pe.container.destroy({ children: true });
  textures.clear();
});

/** An outline colour other than the default ivory, as a flagged pick draws. */
const FLAGGED = 0xe0a030;

it('lays a static outline again only once the body is bound anew, the zoom moves or the band changes', () => {
  const textures = new TextureCache();
  const effects = new SelectionEffects(textures);
  const pe = createPooled('building', undefined);
  if (pe.paletted) throw new Error('Expected a plain building');
  const body = new SelectionSprite(Texture.WHITE);
  pe.sprites.push(body);
  pe.pickExempt.push(false);
  pe.container.addChild(body);
  const laidX = (): number => {
    const quad = pe.container.children[0]?.children[0];
    if (!(quad instanceof OutlineSprite)) throw new Error('Missing outline');
    return quad.position.x;
  };
  effects.update(pe, 'outline', 1, 0, undefined, undefined, undefined, undefined, pe.bindSerial);
  const first = laidX();
  body.position.x += 5;
  effects.update(pe, 'outline', 1, 0.5, undefined, undefined, undefined, undefined, pe.bindSerial);
  expect(laidX()).toBe(first);
  pe.bindSerial++;
  effects.update(pe, 'outline', 1, 0.5, undefined, undefined, undefined, undefined, pe.bindSerial);
  expect(laidX()).toBeCloseTo(first + 5);
  body.position.x += 5;
  effects.update(pe, 'outline', 2, 0.5, undefined, undefined, undefined, undefined, pe.bindSerial);
  const atZoom = laidX();
  expect(atZoom).not.toBeCloseTo(first + 5);
  body.position.x += 5;
  effects.update(pe, 'outline', 2, 0.5, FLAGGED, undefined, undefined, undefined, pe.bindSerial);
  const recoloured = laidX();
  expect(recoloured).not.toBeCloseTo(atZoom);
  body.position.x += 5;
  // A pick target's mark lift widens the band.
  effects.update(pe, 'outline', 2, 0.5, FLAGGED, undefined, 0, undefined, pe.bindSerial);
  expect(laidX()).not.toBeCloseTo(recoloured);
  effects.clear(pe);
  pe.container.destroy({ children: true });
  textures.clear();
});

/** `quad` laid over the mesh's own corners: texel (u, v) of the body frame sits `margin` texels into
 *  the grown frame, and one reach step in uv moves a body texel by exactly the reach on screen. */
function expectOverMesh(
  quad: OutlineSprite,
  body: PalettedSprite,
  frame: { width: number; height: number },
  reach: number,
  page: number,
): void {
  const margin = (quad.texture.frame.width - frame.width) / 2;
  expect(Number.isInteger(margin)).toBe(true);
  quad.updateLocalTransform();
  const m = quad.localTransform;
  const corners = body.geometry.positions;
  const texels = [
    [0, 0],
    [frame.width, 0],
    [frame.width, frame.height],
    [0, frame.height],
  ];
  for (const [i, [u = 0, v = 0]] of texels.entries()) {
    const px = corners[2 * i] ?? 0;
    const py = corners[2 * i + 1] ?? 0;
    expect(m.a * (u + margin) + m.c * (v + margin) + m.tx).toBeCloseTo(3 + 2 * (px + 0.1 * py));
    expect(m.b * (u + margin) + m.d * (v + margin) + m.ty).toBeCloseTo(4 + 2 * py);
  }
  const step = (du: number, dv: number) => [m.a * du + m.c * dv, m.b * du + m.d * dv];
  const [xStepX = 0, xStepY = 0] = step((quad.reachUv[0] ?? 0) * page, (quad.reachUv[1] ?? 0) * page);
  const [yStepX = 0, yStepY = 0] = step((quad.reachUv[2] ?? 0) * page, (quad.reachUv[3] ?? 0) * page);
  expect(xStepX).toBeCloseTo(reach);
  expect(xStepY).toBeCloseTo(0);
  expect(yStepX).toBeCloseTo(0);
  expect(yStepY).toBeCloseTo(reach);
  // The grown quad reaches past every texel a tap can land on.
  expect(Math.hypot(quad.reachUv[0] ?? 0, quad.reachUv[1] ?? 0) * page).toBeLessThanOrEqual(margin);
  expect(Math.hypot(quad.reachUv[2] ?? 0, quad.reachUv[3] ?? 0) * page).toBeLessThanOrEqual(margin);
}

const PAGE = 32;

it('keeps vehicle outlines out of linear atlas sampling and follows mesh origin and shear', () => {
  const textures = new TextureCache();
  const effects = new SelectionEffects(textures);
  const lut = syntheticHumanLut();
  const pe = createPooled('vehicle', lut);
  if (!pe.paletted) throw new Error('Expected an indexed vehicle');
  const source = new TextureSource({ width: PAGE, height: PAGE, scaleMode: 'nearest' });
  const body = new PalettedSprite(lut.source, lut.colours);
  const frame = { x: 0, y: 0, width: 16, height: 24, offsetX: -8, offsetY: -24 };
  body.setFrame(source, frame, PAGE, PAGE);
  body.artScale = 2;
  body.artDx = 3;
  body.artDy = 4;
  body.shear = 0.1;
  pe.sprites.push(body);
  pe.container.addChild(body);
  effects.update(pe, 'outline', 0.75, 0);
  expect(textures.pageSources().has(source)).toBe(false);
  const quad = pe.container.children[0]?.children[0];
  if (!(quad instanceof OutlineSprite)) throw new Error('Missing outline quad');
  expect(quad.bodyTexture.frame.width).toBe(frame.width);
  expectOverMesh(quad, body, frame, 2 / 0.75, PAGE);
  effects.clear(pe);
  pe.container.destroy({ children: true });
  textures.clear();
  source.destroy();
  lut.source.destroy();
});

it("lays a tilted frame's vehicle outline over the mesh's own turned corners", () => {
  const textures = new TextureCache();
  const effects = new SelectionEffects(textures);
  const lut = syntheticHumanLut();
  const pe = createPooled('vehicle', lut);
  if (!pe.paletted) throw new Error('Expected an indexed vehicle');
  const source = new TextureSource({ width: PAGE, height: PAGE, scaleMode: 'nearest' });
  const body = new PalettedSprite(lut.source, lut.colours);
  const frame = { x: 0, y: 0, width: 16, height: 24, offsetX: -8, offsetY: -24, tilt: 0.4 };
  body.setFrame(source, frame, PAGE, PAGE);
  body.artScale = 2;
  body.artDx = 3;
  body.artDy = 4;
  body.shear = 0.1;
  pe.sprites.push(body);
  pe.container.addChild(body);
  effects.update(pe, 'outline', 0.75, 0);
  const outline = pe.container.children[0];
  const dark = outline?.children[0];
  const ivory = outline?.children[1];
  if (!(dark instanceof OutlineSprite) || !(ivory instanceof OutlineSprite))
    throw new Error('Missing outline');
  expectOverMesh(dark, body, frame, 2 / 0.75, PAGE);
  expectOverMesh(ivory, body, frame, 1.25 / 0.75, PAGE);
  effects.clear(pe);
  pe.container.destroy({ children: true });
  textures.clear();
  source.destroy();
  lut.source.destroy();
});
