import {
  type AtlasFrame,
  type BuildingSignSheet,
  buildTimeThreshold,
  CONSTRUCTION_SIGN_DX,
  GeometryDebugLayer,
  halfCellToScreen,
  makePlaceholderStack,
  makeSignStack,
  resolveConstructionDraws,
  type SpriteLayer,
  TextureCache,
  TILE_HALF_H,
  TILE_HALF_W,
} from '@open-northland/render';
import type { Box } from '@open-northland/render/data';
import { TICKS_PER_SECOND } from '@open-northland/sim';
import { Container, Graphics, Sprite } from 'pixi.js';
import { BUILDING_SCALE } from '../../content/building-gfx/index.js';
import { loadOwnBuildingLayers } from '../../content/own-assets/building-layers.js';
import {
  ownBuildingBindings,
  ownLayerScale,
  ownOverlayLayer,
} from '../../content/own-assets/building-manifest.js';
import { type BuildingGeometry, geometryBounds, unionBox } from './building-geometry.js';
import type { GalleryBuilding, GalleryCharacter } from './catalog.js';
import type { DecodedFrame, OriginalBuildingOf } from './original-buildings.js';
import { characterPreview } from './preview-character.js';
import type { PreviewPanel } from './preview-state.js';

/** What a building panel draws besides the package itself: its logic geometry, the sign art the badges
 *  use, and the original body it replaces when that art is loaded. */
export interface BuildingPreviewContext {
  readonly geometryOf: (manifest: GalleryBuilding['manifest']) => BuildingGeometry;
  /** Player-slot-0 sign art; absent draws the placeholder chain. */
  readonly signs?: BuildingSignSheet | undefined;
  /** The decoded original bodies; `null` until loaded or when content is absent. */
  readonly original: OriginalBuildingOf | null;
}

const PANEL_PAD_X = 20;
const PANEL_PAD_TOP = 25;
const PANEL_PAD_BOTTOM = 25;
/** World px the reference civilian's feet sit below the door point, so it reads as standing in the doorway. */
const REFERENCE_FOOT_DROP = 15;
const LATTICE_ALPHA = 0.28;

/** The world-px box a frame drawn at the anchor covers. */
function frameBox(frame: AtlasFrame, scale: number): Box {
  return {
    minX: frame.offsetX * scale,
    minY: frame.offsetY * scale,
    maxX: (frame.offsetX + frame.width) * scale,
    maxY: (frame.offsetY + frame.height) * scale,
  };
}

/** A decoded frame as a sprite at its authored offset from the anchor, plus `dx` world px. */
function placed(art: DecodedFrame, cache: TextureCache, dx = 0): Sprite {
  const sprite = new Sprite(cache.get(art.source, art.frame));
  sprite.position.set(art.frame.offsetX + dx, art.frame.offsetY);
  return sprite;
}

/** One own layer's frame 0 as a sprite at its manifest offset, scaled to world px; textureless without
 *  a cache, for the construction-stage sprites `update` retextures per progress. */
function placedOwn(layer: SpriteLayer | undefined, scale: number, cache?: TextureCache): Sprite | undefined {
  const frame = layer?.atlas.frames.get(0);
  if (layer === undefined || frame === undefined) return undefined;
  const sprite = cache === undefined ? new Sprite() : new Sprite(cache.get(layer.source, frame));
  sprite.scale.set(scale);
  sprite.position.set(frame.offsetX * scale, frame.offsetY * scale);
  return sprite;
}

/** The faint half-cell lattice under the building: one diamond per node across the panel box. */
function latticeGraphic(box: Box): Graphics {
  const g = new Graphics();
  const rx = TILE_HALF_W / 2;
  const ry = TILE_HALF_H / 4;
  for (let hy = Math.floor(box.minY / ry / 2) - 1; hy * ry * 2 <= box.maxY + ry; hy++) {
    for (let hx = Math.floor(box.minX / rx / 2) - 1; hx * rx * 2 <= box.maxX + rx; hx++) {
      const p = halfCellToScreen(hx, hy);
      g.moveTo(p.x, p.y - ry)
        .lineTo(p.x + rx, p.y)
        .lineTo(p.x, p.y + ry)
        .lineTo(p.x - rx, p.y)
        .closePath();
    }
  }
  return g.stroke({ width: 1, color: 0xffffff, alpha: LATTICE_ALPHA });
}

export async function buildingPreview(
  entry: GalleryBuilding,
  reference: GalleryCharacter | undefined,
  context: BuildingPreviewContext,
): Promise<PreviewPanel> {
  const manifest = entry.manifest;
  const files = new Map([[manifest.sprite, entry.image]]);
  if (manifest.shadow && entry.shadowImage) {
    files.set(manifest.shadow.sprite, entry.shadowImage);
  }
  if (manifest.overlay && entry.overlayImage) {
    files.set(manifest.overlay.sprite, entry.overlayImage);
  }
  manifest.construction?.forEach((stage, i) => {
    const paths = entry.construction[i];
    if (paths) {
      files.set(stage.sprite, paths.image);
      files.set(stage.timeMask, paths.timeMask);
    }
  });
  const layers = await loadOwnBuildingLayers(manifest, (filename) => files.get(filename));
  const person = reference === undefined ? undefined : await characterPreview(reference);
  const binding = ownBuildingBindings(0, [manifest]);
  const cache = new TextureCache();
  const geometry = context.geometryOf(manifest);
  const original = context.original?.(manifest);
  const door = halfCellToScreen(manifest.doorNode.x, manifest.doorNode.y);

  // Everything hangs off the anchor node, so the panel box is the union of what may be drawn there.
  let box = geometryBounds(geometry);
  for (const [key, layer] of Object.entries(layers)) {
    for (const frame of [layer.atlas.frames.get(0), layer.shadow?.atlas.frames.get(0)]) {
      if (frame !== undefined) box = unionBox(box, frameBox(frame, ownLayerScale(manifest, key)));
    }
  }
  if (original !== undefined) {
    box = unionBox(box, frameBox(original.frame, BUILDING_SCALE));
    if (original.shadow !== undefined) box = unionBox(box, frameBox(original.shadow.frame, BUILDING_SCALE));
  }
  if (person !== undefined) {
    box = unionBox(box, {
      minX: door.x - person.width / 2,
      minY: door.y - person.height + REFERENCE_FOOT_DROP,
      maxX: door.x + person.width / 2,
      maxY: door.y + REFERENCE_FOOT_DROP,
    });
  }

  const container = new Container();
  const anchor = new Container();
  anchor.position.set(PANEL_PAD_X - box.minX, PANEL_PAD_TOP - box.minY);
  container.addChild(anchor);
  const lattice = latticeGraphic(box);
  anchor.addChild(lattice);

  const originalShadow = original?.shadow === undefined ? undefined : placed(original.shadow, cache);
  if (originalShadow !== undefined) anchor.addChild(originalShadow);
  const shadowSprite = placedOwn(layers[manifest.layer]?.shadow, entry.scale, cache);
  if (shadowSprite !== undefined) anchor.addChild(shadowSprite);
  const originalSprite = original === undefined ? undefined : placed(original, cache);
  if (originalSprite !== undefined) anchor.addChild(originalSprite);
  const sprites: Record<string, Sprite> = {};
  for (const [key, layer] of Object.entries(layers)) {
    const sprite = placedOwn(layer, ownLayerScale(manifest, key));
    if (sprite === undefined) continue;
    sprites[key] = sprite;
    anchor.addChild(sprite);
  }
  const spinLayer = manifest.overlay === undefined ? undefined : layers[ownOverlayLayer(manifest)];
  const spinSprite = manifest.overlay === undefined ? undefined : sprites[ownOverlayLayer(manifest)];
  const spin =
    manifest.overlay !== undefined && spinLayer !== undefined && spinSprite !== undefined
      ? { overlay: manifest.overlay, layer: spinLayer, sprite: spinSprite }
      : undefined;
  if (person) {
    person.container.position.set(door.x - person.width / 2, door.y - person.height + REFERENCE_FOOT_DROP);
    anchor.addChild(person.container);
  }

  const cells = new GeometryDebugLayer();
  cells.set([
    {
      anchor: { hx: 0, hy: 0 },
      blocked: geometry.blocked,
      reserved: geometry.reserved,
      door: geometry.door,
      label: geometry.label,
    },
  ]);
  anchor.addChild(cells.container);
  const signs = context.signs;
  const stack =
    signs === undefined
      ? makePlaceholderStack(geometry.signRows, false)
      : makeSignStack(geometry.signRows, false, cache, signs);
  stack.position.set(geometry.post.x, geometry.post.y);
  anchor.addChild(stack);
  const stand =
    signs === undefined
      ? undefined
      : placed({ source: signs.source, frame: signs.frameByKind.construction }, cache, CONSTRUCTION_SIGN_DX);
  if (stand !== undefined) {
    stand.position.x += geometry.post.x;
    stand.position.y += geometry.post.y;
    anchor.addChild(stand);
  }

  const notes: string[] = [];
  if (!geometry.fromContent)
    notes.push(`${entry.name}: no local content, so no footprint cells; the door is the manifest's node.`);
  if (context.original !== null && original === undefined)
    notes.push(`${entry.name}: no original body for this type.`);

  let stamp = 0;
  let drawn: number | 'original' | undefined;
  return {
    container,
    width: box.maxX - box.minX + 2 * PANEL_PAD_X,
    height: box.maxY - box.minY + PANEL_PAD_TOP + PANEL_PAD_BOTTOM,
    notes,
    update(state, seconds) {
      person?.update({ ...state, clip: 'idle', frame: 0 }, seconds);
      const showOriginal = state.assets === 'original' && original !== undefined;
      if (spin !== undefined) {
        // The finished building advances one working frame every `ticksPerFrame` sim ticks of the shared clock.
        const { working, ticksPerFrame } = spin.overlay;
        const bob = working[Math.floor((seconds * TICKS_PER_SECOND) / ticksPerFrame) % working.length];
        const frame = bob === undefined ? undefined : spin.layer.atlas.frames.get(bob);
        if (frame !== undefined) spin.sprite.texture = cache.get(spin.layer.source, frame);
        spin.sprite.visible = !showOriginal && state.progress >= 100;
      }
      lattice.visible = state.geometry;
      cells.container.visible = state.geometry;
      stack.visible = state.geometry && state.progress >= 100;
      if (stand !== undefined) stand.visible = state.geometry && state.progress < 100;
      if (originalSprite !== undefined) originalSprite.visible = showOriginal;
      if (originalShadow !== undefined) originalShadow.visible = showOriginal;
      const wanted = showOriginal ? 'original' : state.progress;
      if (wanted === drawn) return;
      drawn = wanted;
      for (const sprite of Object.values(sprites)) if (sprite !== spin?.sprite) sprite.visible = false;
      if (shadowSprite) shadowSprite.visible = false;
      if (showOriginal) return;
      if (shadowSprite) shadowSprite.visible = state.progress >= 100 || manifest.construction === undefined;
      stamp++;
      const draws =
        state.progress >= 100
          ? null
          : resolveConstructionDraws(binding, {
              kind: 'building',
              ref: 0,
              x: 0,
              y: 0,
              depth: 0,
              typeId: manifest.typeId,
              tribe: manifest.tribeId,
              builtPct: state.progress,
            });
      for (const draw of draws ?? [{ layer: manifest.layer, bob: 0 }]) {
        const key = draw.layer ?? manifest.layer;
        const layer = layers[key];
        const sprite = sprites[key];
        const frame = layer?.atlas.frames.get(0);
        if (!layer || !sprite || !frame) throw new Error(`Missing building layer ${entry.id}/${key}`);
        sprite.visible = true;
        sprite.texture =
          layer.times && 'fromPct' in draw
            ? (cache.revealed(
                layer.source,
                frame,
                layer.times,
                buildTimeThreshold(state.progress / 100, draw.fromPct, draw.toPct),
                stamp,
              ) ?? cache.get(layer.source, frame))
            : cache.get(layer.source, frame);
      }
    },
    destroy() {
      person?.destroy();
      container.destroy({ children: true });
      cache.clear();
    },
  };
}
