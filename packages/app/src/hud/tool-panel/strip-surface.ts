import type { PalettedSprite } from '@open-northland/render';
import { type Application, type Container, Graphics } from 'pixi.js';
import { type GuiArt, makeGuiSprite } from '../../content/gui-art.js';
import {
  MESSAGE_PRIORITY_FRAME,
  TOOL_PANEL_STRIP,
  type ToolButtonId,
  type ToolPanelLayout,
} from './layout.js';
import { buildOutlinedButtonSpecs } from './strip-outline.js';
import { createSupersampledStrip, type StripSpriteSpec, type SupersampledStrip } from './strip-texture.js';

/** Strip and button block colours drawn when the decoded GUI art is absent. */
const FALLBACK_STRIP = 0x1c1810;
const FALLBACK_BUTTON = 0x4a3f28;
const FALLBACK_BUTTON_BORDER = 0x8a744a;
/** Inset of a flat button block inside its placed rect, on every side (screen px). */
const FALLBACK_BUTTON_INSET = 2;

const NO_SPRITES: readonly PalettedSprite[] = [];

/** The strip's live bake, read through getters because a re-bake replaces it. */
export interface StripBake {
  current(): SupersampledStrip | null;
  /** Show atlas frame `gfx` on a stateful button: its outline stamps and glyph are re-framed together
   *  and the bake redrawn. A no-op for the flat fallback or a stateless button. */
  reframe(id: ToolButtonId, gfx: number): void;
}

export interface StripSurface extends StripBake {
  /** Re-bake at the renderer's resolution when a live DPR change moved it; true when it re-baked. */
  syncResolution(): boolean;
  dispose(): void;
}

export interface StripSurfaceDeps {
  readonly app: Application;
  readonly container: Container;
  readonly layout: ToolPanelLayout;
  readonly art: GuiArt | null;
}

export function createStripSurface(deps: StripSurfaceDeps): StripSurface {
  const { app, container, layout, art } = deps;
  if (art === null) {
    drawFlatStrip(container, layout);
    return {
      current: () => null,
      reframe: () => undefined,
      syncResolution: () => false,
      dispose: () => undefined,
    };
  }

  let bake: SupersampledStrip | null = null;
  let stateSprites: ReadonlyMap<ToolButtonId, readonly PalettedSprite[]> = new Map();
  let bakedResolution = app.renderer.resolution;

  const rebake = (): void => {
    bake?.display.destroy();
    bake?.dispose();
    // Deviation from the original's opaque panel: the strip keys its near-black backdrop away, so the
    // world shows past the carved silhouette.
    const specs: StripSpriteSpec[] = [];
    const backdrop = makeGuiSprite(art, layout.stripGfx, {
      defaultPalette: 'iconsleft',
      colorKey: 'full',
    });
    if (backdrop !== null) specs.push({ spr: backdrop.sprite, design: TOOL_PANEL_STRIP });
    const frame = makeGuiSprite(art, layout.frameGfx, { defaultPalette: 'iconsleft', colorKey: 'full' });
    if (frame !== null) specs.push({ spr: frame.sprite, design: MESSAGE_PRIORITY_FRAME });
    const outlined = buildOutlinedButtonSpecs(art, layout.buttons);
    specs.push(...outlined.specs);
    stateSprites = outlined.stateSprites;
    bake = createSupersampledStrip({
      app,
      bounds: layout.designBounds,
      scale: layout.scale,
      sprites: specs,
    });
    container.addChild(bake.display);
    bakedResolution = app.renderer.resolution;
  };
  rebake();

  return {
    current: () => bake,
    reframe: (id, gfx): void => {
      const frame = art.layer.atlas.frames.get(gfx);
      const glyphs = stateSprites.get(id) ?? NO_SPRITES;
      if (frame === undefined || glyphs.length === 0) return;
      for (const s of glyphs)
        s.setFrame(art.layer.source, frame, art.layer.atlas.width, art.layer.atlas.height);
      bake?.redraw();
    },
    syncResolution: () => {
      if (app.renderer.resolution === bakedResolution) return false;
      rebake();
      return true;
    },
    dispose: () => bake?.dispose(),
  };
}

function drawFlatStrip(container: Container, layout: ToolPanelLayout): void {
  const g = new Graphics();
  g.rect(layout.strip.x, layout.strip.y, layout.strip.w, layout.strip.h).fill(FALLBACK_STRIP);
  for (const b of layout.buttons) {
    g.rect(
      b.placed.x + FALLBACK_BUTTON_INSET,
      b.placed.y + FALLBACK_BUTTON_INSET,
      b.placed.w - 2 * FALLBACK_BUTTON_INSET,
      b.placed.h - 2 * FALLBACK_BUTTON_INSET,
    )
      .fill(FALLBACK_BUTTON)
      .stroke({ color: FALLBACK_BUTTON_BORDER, width: 1 });
  }
  g.rect(layout.frame.x, layout.frame.y, layout.frame.w, layout.frame.h).fill(FALLBACK_STRIP);
  container.addChild(g);
}
