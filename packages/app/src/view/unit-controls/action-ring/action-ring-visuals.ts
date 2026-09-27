import type { Application } from 'pixi.js';
import type { GuiArt } from '../../../content/gui-art.js';
import type { ActionCommand, ActionRingLayout } from '../../../hud/action-ring/index.js';
import { canvasToClient, type ScreenScale } from '../../../hud/geometry.js';
import { messages } from '../../../i18n/index.js';
import { bakeIconPage, type IconPage } from './icon-page.js';

/** Button corner radius in ring-scaled px, floored so the hover wash keeps a visible round. */
const CORNER_PX = 3;
const MIN_CORNER_PX = 2;

interface ButtonVisual {
  readonly command: ActionCommand;
  readonly button: HTMLElement;
  /** The glyph, a crop of the shared icon page; null draws the flat disc. */
  readonly glyph: HTMLElement | null;
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
 * baked once onto one page from the GUI atlas; without it each button is a flat disc at the same geometry.
 */
export function createActionRingVisuals(deps: ActionRingVisualsDeps): ActionRingVisuals {
  const { app, art, scale, layer } = deps;

  const bake = (): IconPage | null =>
    art === null
      ? null
      : bakeIconPage(
          app,
          art,
          deps.commands.map((command) => command.icon),
          scale,
        );
  /** Mutable: a live DPR change replaces the page at the new density. */
  let page: IconPage | null = null;
  /** Every glyph reads the page off the layer, so a re-bake writes one URL. */
  const setPage = (next: IconPage | null): void => {
    if (next === null) return;
    page = next;
    layer.style.setProperty('--ring-page', `url("${next.url}")`);
  };
  setPage(bake());

  const visuals: ButtonVisual[] = deps.commands.map((command) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'on-ring__button';
    // Out of the tab order: Space is the ring's own key, and a focused button would take it.
    button.tabIndex = -1;
    button.hidden = true;
    button.setAttribute('aria-label', messages().actionRing[command.id]);
    const glyph = page?.cells.has(command.icon) === true ? document.createElement('i') : null;
    if (glyph === null) button.classList.add('on-ring__button--disc');
    else {
      glyph.className = 'on-ring__glyph';
      button.append(glyph);
    }
    button.addEventListener('mousedown', (event) => {
      if (event.button === 0) deps.onPress(command, event);
    });
    button.addEventListener('mouseenter', (event) => deps.onHover(command, event));
    button.addEventListener('mousemove', (event) => deps.onHover(command, event));
    button.addEventListener('mouseleave', () => deps.onHover(null, null));
    layer.append(button);
    return { command, button, glyph, placed: '', shownIn: 0 };
  });
  const visualByCommand = new Map(visuals.map((v) => [v.command, v]));

  /** The renderer resolution the page was baked at; a DPR change re-bakes it at the next placement. */
  let bakedResolution = app.renderer.resolution;
  const rebake = (): void => {
    bakedResolution = app.renderer.resolution;
    setPage(bake());
    for (const v of visuals) v.placed = '';
  };

  /** Crop the glyph's cell off the page at `clientPerPx` client px per canvas px. */
  const paintGlyph = (glyph: HTMLElement, icon: ActionCommand['icon'], clientPerPx: number): void => {
    const cell = page?.cells.get(icon);
    if (page === null || cell === undefined) return;
    const k = clientPerPx / page.oversample;
    const style = glyph.style;
    style.backgroundSize = `${page.width * k}px ${page.height * k}px`;
    style.backgroundPosition = `${-cell.x * k}px ${-cell.y * k}px`;
    style.width = `${cell.w * k}px`;
    style.height = `${cell.h * k}px`;
  };

  let pass = 0;
  const hideAll = (): void => {
    for (const v of visuals) v.button.hidden = true;
  };

  return {
    placeLayout(layout, screen): void {
      if (app.renderer.resolution !== bakedResolution) rebake();
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
        if (v.glyph !== null) paintGlyph(v.glyph, v.command.icon, clientPerPx);
      });
      for (const v of visuals) if (v.shownIn !== pass) v.button.hidden = true;
    },
    hideAll,
    dispose(): void {
      for (const v of visuals) v.button.remove();
    },
  };
}
