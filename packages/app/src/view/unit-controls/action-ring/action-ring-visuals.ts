import type { Application } from 'pixi.js';
import type { GuiArt } from '../../../content/gui-art.js';
import type { ActionCommand, ActionRingLayout } from '../../../hud/action-ring/index.js';
import { canvasToClient, type ScreenScale } from '../../../hud/geometry.js';
import { type IconCanvas, orderIconCanvas } from './icon-canvas.js';

/** Button corner radius in ring-scaled px, floored so the hover wash keeps a visible round. */
const CORNER_PX = 3;
const MIN_CORNER_PX = 2;

interface ButtonVisual {
  readonly command: ActionCommand;
  readonly button: HTMLElement;
  /** Mutable: a live DPR change replaces the bake at the new density. Null draws the flat disc. */
  icon: IconCanvas | null;
  /** The placement last written, so a resting ring writes no style. */
  placed: string;
  /** The placement pass that last showed the button. */
  shownIn: number;
}

export interface ActionRingVisualsDeps {
  readonly app: Application;
  /** Null selects the flat disc fallback. */
  readonly art: GuiArt | null;
  /** Effective ring scale: uiscale × ring factor. */
  readonly scale: number;
  readonly commands: readonly ActionCommand[];
  /** The fixed client-px layer the buttons stand on, above the DOM HUD so a panel never covers them. */
  readonly layer: HTMLElement;
  /** A left press on a button (its event, for propagation control). */
  readonly onPress: (command: ActionCommand, event: MouseEvent) => void;
  /** The cursor over a button (its event) or off every button (null). */
  readonly onHover: (command: ActionCommand | null, event: MouseEvent | null) => void;
}

export interface ActionRingVisuals {
  /** Show the layout's buttons; `screen` turns its canvas px into the layer's client px. */
  placeLayout(layout: ActionRingLayout, screen: ScreenScale): void;
  hideAll(): void;
  dispose(): void;
}

/**
 * The order buttons as DOM elements, one per command, placed from the layout each frame. The glyphs are
 * baked once from the GUI atlas; without it each button is a flat disc at the same geometry.
 */
export function createActionRingVisuals(deps: ActionRingVisualsDeps): ActionRingVisuals {
  const { app, art, scale, layer } = deps;

  const bake = (command: ActionCommand): IconCanvas | null =>
    art === null ? null : orderIconCanvas(app, art, command.icon, scale);

  const visuals: ButtonVisual[] = deps.commands.map((command) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'on-ring__button';
    // Out of the tab order: Space is the ring's own key, and a focused button would take it.
    button.tabIndex = -1;
    button.hidden = true;
    button.setAttribute('aria-label', command.id);
    const icon = bake(command);
    if (icon === null) button.classList.add('on-ring__button--disc');
    else button.append(icon.canvas);
    button.addEventListener('mousedown', (event) => {
      if (event.button === 0) deps.onPress(command, event);
    });
    button.addEventListener('mouseenter', (event) => deps.onHover(command, event));
    button.addEventListener('mousemove', (event) => deps.onHover(command, event));
    button.addEventListener('mouseleave', () => deps.onHover(null, null));
    layer.append(button);
    return { command, button, icon, placed: '', shownIn: 0 };
  });
  const visualByCommand = new Map(visuals.map((v) => [v.command, v]));

  /** The renderer resolution the icons were baked at; a DPR change re-bakes them at the next placement. */
  let bakedResolution = app.renderer.resolution;
  const rebakeIcons = (): void => {
    bakedResolution = app.renderer.resolution;
    for (const v of visuals) {
      if (v.icon === null) continue;
      const next = bake(v.command);
      if (next === null) continue;
      v.icon.canvas.replaceWith(next.canvas);
      v.icon = next;
      v.placed = '';
    }
  };

  let pass = 0;
  const hideAll = (): void => {
    for (const v of visuals) v.button.hidden = true;
  };

  return {
    placeLayout(layout, screen): void {
      if (app.renderer.resolution !== bakedResolution) rebakeIcons();
      pass++;
      layout.buttons.forEach((placed, index) => {
        const v = visualByCommand.get(placed.command);
        if (v === undefined) return;
        v.shownIn = pass;
        v.button.hidden = false;
        const { rect } = placed;
        const from = canvasToClient(screen, rect.x, rect.y);
        const to = canvasToClient(screen, rect.x + rect.w, rect.y + rect.h);
        const left = Math.round(from.x);
        const top = Math.round(from.y);
        const key = `${left},${top},${to.x - from.x},${to.y - from.y},${index}`;
        if (key === v.placed) return;
        v.placed = key;
        const clientPerPx = (to.x - from.x) / rect.w;
        const style = v.button.style;
        style.left = `${left}px`;
        style.top = `${top}px`;
        style.width = `${to.x - from.x}px`;
        style.height = `${to.y - from.y}px`;
        style.borderRadius = `${Math.max(MIN_CORNER_PX, CORNER_PX * scale) * clientPerPx}px`;
        // The layout lists a later-drawn button last, and it takes the click where a row and a column meet.
        style.zIndex = String(index);
        if (v.icon !== null) {
          v.icon.canvas.style.width = `${v.icon.width * clientPerPx}px`;
          v.icon.canvas.style.height = `${v.icon.height * clientPerPx}px`;
        }
      });
      for (const v of visuals) if (v.shownIn !== pass) v.button.hidden = true;
    },
    hideAll,
    dispose(): void {
      for (const v of visuals) v.button.remove();
    },
  };
}
