import { type Application, type Container, Graphics } from 'pixi.js';
import { type GuiArt, type GuiSprite, makeGuiSprite } from '../../../content/gui-art.js';
import { guiFrameIndex } from '../../../content/gui-atlas-map.js';
import type { ActionButton, ActionIconFrame, ActionRingLayout } from '../../../hud/action-ring-layout.js';
import { type BakedIcon, bakeRoundIcon, placeBakedIcon } from '../../../hud/icon-texture.js';

/** Disc colours for the flat fallback drawn only when the decoded GUI art is absent. */
const FALLBACK_FILL = 0x6b4f2a;
const FALLBACK_RIM = 0x2a1d0e;

interface ButtonVisual {
  readonly button: ActionButton;
  /** Mutable: a live DPR change replaces the bake at the new density. */
  icon: BakedIcon | null;
  readonly fallback: Graphics | null;
}

export interface ActionRingVisualsDeps {
  readonly app: Application;
  /** Null selects the flat-Graphics disc fallback. */
  readonly art: GuiArt | null;
  /** Effective ring scale: uiscale × ring factor. */
  readonly scale: number;
  readonly buttons: readonly ActionButton[];
  readonly container: Container;
}

export interface ActionRingVisuals {
  placeLayout(layout: ActionRingLayout): void;
  hideAll(): void;
  dispose(): void;
}

export function createActionRingVisuals(deps: ActionRingVisualsDeps): ActionRingVisuals {
  const { app, art, scale, container } = deps;

  // The 'round' colour key hard-clips outside the inscribed disc, because the original draws no square
  // behind the glyph. That clip aliases unless supersampled, so every icon goes through `bakeRoundIcon`.
  const iconSprite = (frameName: ActionIconFrame): GuiSprite | null =>
    art === null
      ? null
      : makeGuiSprite(art, guiFrameIndex(frameName), { defaultPalette: 'context', colorKey: 'round' });

  // Keyed by the button object, so placement stays correct for a face that shows only a subset.
  const visuals: ButtonVisual[] = [];
  const visualByButton = new Map<ActionButton, ButtonVisual>();
  for (const button of deps.buttons) {
    const sprite = iconSprite(button.icon);
    let icon: BakedIcon | null = null;
    let fallback: Graphics | null = null;
    if (sprite === null) {
      fallback = new Graphics();
      container.addChild(fallback);
    } else {
      icon = bakeRoundIcon({ app, sprite: sprite.sprite, frame: sprite.frame, scale });
      container.addChild(icon.display);
    }
    const v: ButtonVisual = { button, icon, fallback };
    visuals.push(v);
    visualByButton.set(button, v);
  }

  /** The renderer resolution the icons were baked at; a DPR change re-bakes them at the next placement pass. */
  let bakedResolution = app.renderer.resolution;
  const rebakeIcons = (): void => {
    bakedResolution = app.renderer.resolution;
    for (const v of visuals) {
      if (v.icon === null) continue;
      const sprite = iconSprite(v.button.icon);
      if (sprite === null) continue;
      v.icon.display.destroy();
      v.icon.dispose();
      v.icon = bakeRoundIcon({ app, sprite: sprite.sprite, frame: sprite.frame, scale });
      container.addChild(v.icon.display);
    }
  };

  /** Centre one button's visual in its layout rect (the original's `SetCenterGraphicsFlag`). */
  const placeVisual = (v: ButtonVisual, rect: { x: number; y: number; w: number; h: number }): void => {
    if (v.icon !== null) {
      placeBakedIcon(v.icon, rect);
    } else if (v.fallback !== null) {
      const r = Math.min(rect.w, rect.h) / 2;
      v.fallback
        .clear()
        .circle(Math.round(rect.x + rect.w / 2), Math.round(rect.y + rect.h / 2), r)
        .fill(FALLBACK_FILL)
        .stroke({ color: FALLBACK_RIM, width: Math.max(1, scale) });
    }
  };

  const hideAll = (): void => {
    for (const v of visuals) {
      if (v.icon !== null) v.icon.display.visible = false;
      if (v.fallback !== null) v.fallback.visible = false;
    }
  };

  return {
    placeLayout(layout: ActionRingLayout): void {
      if (app.renderer.resolution !== bakedResolution) rebakeIcons();
      hideAll();
      for (const placed of layout.buttons) {
        const v = visualByButton.get(placed.button);
        if (v === undefined) continue;
        if (v.icon !== null) v.icon.display.visible = true;
        if (v.fallback !== null) v.fallback.visible = true;
        placeVisual(v, placed.rect);
      }
    },
    hideAll,
    dispose(): void {
      for (const v of visuals) v.icon?.dispose();
    },
  };
}
