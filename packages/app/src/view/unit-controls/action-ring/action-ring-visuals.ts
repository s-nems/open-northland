import { type Application, type Container, Graphics } from 'pixi.js';
import { type GuiArt, type GuiSprite, makeGuiSprite } from '../../../content/gui-art.js';
import { guiFrameIndex } from '../../../content/gui-atlas-map.js';
import type { ActionButton, ActionIconFrame, ActionRingLayout } from '../../../hud/action-ring-layout.js';
import { type BakedIcon, bakeRoundIcon, placeBakedIcon } from '../../../hud/icon-texture.js';

/** Flat-fallback disc colours (only when the decoded GUI art is absent) — a wooden button + rim. */
const FALLBACK_FILL = 0x6b4f2a;
const FALLBACK_RIM = 0x2a1d0e;

/** One built button: its spec + the supersampled baked icon (real art) or the flat fallback disc. */
interface ButtonVisual {
  readonly button: ActionButton;
  /** The crisp, supersampled order-icon (real-art path) — baked once, re-placed each frame. */
  readonly icon: BakedIcon | null;
  readonly fallback: Graphics | null;
}

/** What the action-ring visuals need from the mounted menu. */
export interface ActionRingVisualsDeps {
  readonly app: Application;
  /** The decoded GUI art, or null → the flat-Graphics disc fallback. */
  readonly art: GuiArt | null;
  /** The ring's effective scale (uiscale × ring factor) — feeds the icon bake and the fallback rim width. */
  readonly scale: number;
  /** Every button the default menu can show (built once, placed by identity per frame). */
  readonly buttons: readonly ActionButton[];
  /** The container the button graphics are added to (a child of the menu root). */
  readonly container: Container;
}

/** The retained button graphics of the settler action ring — built once, shown/placed per frame by layout. */
export interface ActionRingVisuals {
  /** Show + place only the buttons this layout produced (hiding the rest); placed by button identity. */
  placeLayout(layout: ActionRingLayout): void;
  /** Hide every button visual (a closed / anchorless menu). */
  hideAll(): void;
  /** Free each baked icon's off-screen texture. */
  dispose(): void;
}

/**
 * Build and manage the settler action ring's button graphics — the round order-icon discs (real GUI art
 * baked crisp at the fractional UI scale, or flat-Graphics discs when `content/` is absent). Split from the
 * menu state machine + input in {@link import('./settler-actions.js')}: this only owns the retained
 * per-button visuals and their per-frame placement.
 */
export function createActionRingVisuals(deps: ActionRingVisualsDeps): ActionRingVisuals {
  const { app, art, scale, container } = deps;

  // The order-icon sprite + its atlas frame for one button, or null when the art / frame is missing.
  // 'round' key: hard-clip outside the inscribed disc so the button reads as a round wooden disc (the
  // original has no square behind it), keeping the engraved glyph. The hard clip aliases unless
  // supersampled, so every icon goes through `bakeRoundIcon` below. See PalettedSprite.colorKey / GuiColorKey.
  const iconSprite = (frameName: ActionIconFrame): GuiSprite | null =>
    art === null
      ? null
      : makeGuiSprite(art, guiFrameIndex(frameName), { defaultPalette: 'context', colorKey: 'round' });

  // Build every button's visual once (retained graph — placed each frame, never re-created). Keyed by the
  // button object so placement is by identity, robust to a face that shows only a subset of buttons.
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
      // Supersample the round order-icon into a texture (crisp at the fractional UI scale — see
      // hud/icon-texture.ts); the display sprite is what the scene graph draws + re-places each frame.
      icon = bakeRoundIcon({ app, sprite: sprite.sprite, frame: sprite.frame, scale });
      container.addChild(icon.display);
    }
    const v: ButtonVisual = { button, icon, fallback };
    visuals.push(v);
    visualByButton.set(button, v);
  }

  /**
   * Place one button's visual centred in its layout rect (the original's `SetCenterGraphicsFlag`). The baked
   * icon is a scene-graph sprite, centred + pixel-snapped by {@link placeBakedIcon}; the flat fallback draws
   * a disc at the same centre.
   */
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
      // Place by button identity (not index): hide every visual first, then show + place only the buttons
      // this frame's layout actually produced.
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
      for (const v of visuals) v.icon?.dispose(); // free each baked icon's off-screen texture
    },
  };
}
