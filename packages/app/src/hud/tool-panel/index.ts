import type { HudLayout, PalettedSprite } from '@vinland/render';
import type { Command } from '@vinland/sim';
import { type Application, Container, Graphics } from 'pixi.js';
import { loadGuiArt, makeGuiSprite } from '../../content/gui-art.js';
import { type GuiStrings, loadGuiStrings } from '../../content/gui-gfx.js';
import { type TextRun, loadBitmapFont, makeTextRun } from '../bitmap-text.js';
import { HOVER_ALPHA, HOVER_TINT } from '../chrome.js';
import type { MenuBuildingEntry } from './building-menu.js';
import type { PanelContext } from './context.js';
import {
  DEFAULT_GAME_SPEED_STATE,
  type GameSpeedState,
  type GameSpeedStateSpec,
  gameSpeedSpec,
  nextGameSpeedState,
} from './game-speed.js';
import {
  type PlacedRect,
  type ToolButtonId,
  buildToolPanelLayout,
  hitTestToolPanel,
  pointOverToolPanel,
} from './layout.js';
import { createMenuWindow } from './menu-window.js';
import { createPlacementController } from './placement.js';
import { createStatsWindow } from './stats-window.js';

/**
 * The LEFT in-game tool panel — the retained screen-space HUD that draws the original toolbar strip, the
 * tool buttons, the working game-speed button, and the pop-up building / statistics windows, and claims the
 * clicks that land on it (so they never fall through to world picking).
 *
 * Rendering: strip/buttons/speed draw as `PalettedSprite`s over the indexed `ls_gui_window` atlas,
 * coloured through the GUI palette LUT (the same mechanism as player colours) — bitmap-native, no DOM. When
 * the decoded GUI art is absent (a checkout that hasn't run the GUI pipeline stage) the panel DEGRADES to
 * flat `Graphics` blocks at the exact same pinned geometry, staying visible and fully interactive; the
 * pop-up window chrome is a parchment `Graphics` panel in both modes (`hud/chrome.ts`). Text is the decoded
 * `.fnt` bitmap font when present, else a Pixi `Text` fallback (`makeTextRun`).
 *
 * The package splits by concern: the pure geometry / speed-state / menu models (`layout.ts`,
 * `game-speed.ts`, `building-menu.ts` — headlessly unit-tested) from the window controllers
 * (`menu-window.ts`, `stats-window.ts`, `placement.ts` — each owning its own graphics + state over the
 * shared {@link PanelContext}); this module mounts the strip, owns the speed button, and routes input.
 */

export interface ToolPanelOptions {
  readonly app: Application;
  readonly canvas: HTMLCanvasElement;
  /** Integer UI scale (from `?uiscale=`); the pinned internal geometry is multiplied by this. */
  readonly uiscale: number;
  /** The buildings the menu lists (typeId + label + kind) — e.g. derived from the viking catalog. */
  readonly buildings: readonly MenuBuildingEntry[];
  /** Language for the decoded UI strings (`pol`/`eng`); falls back to the pinned Polish labels when absent. */
  readonly lang: string;
  /** The tribe whose read-view stats the statistics window shows. */
  readonly tribe: number;
  /** The player slot a placed building is owned by. */
  readonly owner: number;
  /** Submit a command into the sim (the one-way seam) — the building menu's `placeBuilding`. */
  readonly enqueue: (command: Command) => void;
  /** Convert a client (CSS) point to a map tile, or `null` off the map — the placement target. */
  readonly screenToTile: (clientX: number, clientY: number) => { col: number; row: number } | null;
  /** Apply a game-speed change to the app loop (drives the fixed-timestep multiplier / pause). */
  readonly onSpeedChange: (spec: GameSpeedStateSpec) => void;
  /** Backing-store scale mapper (client px → canvas px) — shared with the unit controls. */
  readonly backingScale: (canvas: HTMLCanvasElement) => { sx: number; sy: number; rect: DOMRect };
}

export interface ToolPanelController {
  /** True when a client point should be CLAIMED by the HUD (over the strip, an open window, or in placement). */
  claimsPointer(clientX: number, clientY: number): boolean;
  /**
   * Per-frame hook: re-place the screen-space sprites and refresh the open statistics window. Takes the
   * frame's ALREADY-BUILT HUD layout (the caller builds it once for the always-on HUD) so the panel does
   * not run a second O(entities) `buildHud` scan.
   */
  update(hud: HudLayout): void;
  dispose(): void;
}

/** Fallback strip / button block colours (only used when the decoded GUI art is absent). */
const FALLBACK_STRIP = 0x1c1810;
const FALLBACK_BUTTON = 0x4a3f28;
const FALLBACK_BUTTON_BORDER = 0x8a744a;
/** Fallback speed-glyph nudges inside the button rect (design px). */
const SPEED_LABEL_INSET_X = 4;
const SPEED_LABEL_RAISE_Y = 3;

/**
 * Mount the tool panel onto the app stage. Async because it loads the (optional) decoded GUI art + font;
 * everything degrades gracefully so a checkout without `content/` still boots and the panel stays usable.
 */
export async function mountToolPanel(opts: ToolPanelOptions): Promise<ToolPanelController> {
  const { app, canvas, enqueue } = opts;
  const layout = buildToolPanelLayout(opts.uiscale);
  const scale = layout.scale;

  const [art, strings, font] = await Promise.all([loadGuiArt(), loadGuiStrings(opts.lang), loadBitmapFont()]);

  const labelByType = new Map(opts.buildings.map((b) => [b.typeId, b.label]));

  // --- Pixi containers (screen-space children of the stage; drawn over the world) --------------------
  const root = new Container();
  root.zIndex = 1000;
  app.stage.addChild(root);
  const stripContainer = new Container();
  const hoverContainer = new Container();
  const windowContainer = new Container(); // menu + stats windows
  const bannerContainer = new Container(); // placement banner
  root.addChild(stripContainer, windowContainer, hoverContainer, bannerContainer);

  const hoverG = new Graphics();
  hoverContainer.addChild(hoverG);

  // --- The strip + buttons (real sprites, or a flat-Graphics fallback) ------------------------------
  const panelSprites: { readonly spr: PalettedSprite; readonly rect: PlacedRect }[] = [];
  let speedSprite: PalettedSprite | null = null;

  if (art !== null) {
    // Key EVERY panel sprite (strip + buttons). The GUI palettes reserve index 0 (magenta) + a near-black
    // band as each element's background, but a bob writes them OPAQUE (the engine blitter has no colour key,
    // and the original hid its opaque panel by rendering gameplay in a dedicated area). We render the world
    // full-screen, so this is a DELIBERATE deviation: key those colours transparent so the floating HUD shows
    // only the ornament + glyphs and never paints a dark rectangle over the terrain (source basis).
    const strip = makeGuiSprite(art, layout.stripGfx, { defaultPalette: 'iconsleft', colorKey: 'full' });
    if (strip !== null) {
      stripContainer.addChild(strip.sprite);
      panelSprites.push({ spr: strip.sprite, rect: layout.strip });
    }
    for (const b of layout.buttons) {
      const gs = makeGuiSprite(art, b.gfx, { defaultPalette: 'iconsleft', colorKey: 'full' });
      if (gs === null) continue;
      stripContainer.addChild(gs.sprite);
      panelSprites.push({ spr: gs.sprite, rect: b.placed });
      if (b.id === 'speed') speedSprite = gs.sprite;
    }
  } else {
    const g = new Graphics();
    g.rect(layout.strip.x, layout.strip.y, layout.strip.w, layout.strip.h).fill(FALLBACK_STRIP);
    for (const b of layout.buttons) {
      g.rect(b.placed.x + 2, b.placed.y + 2, b.placed.w - 4, b.placed.h - 4)
        .fill(FALLBACK_BUTTON)
        .stroke({ color: FALLBACK_BUTTON_BORDER, width: 1 });
    }
    stripContainer.addChild(g);
  }

  // --- The shared controller context ------------------------------------------------------------------
  const ctx: PanelContext = {
    layout,
    scale,
    makeText: (text, color) => makeTextRun(font, text, color, scale),
    uiString: (table, id, fallback) => (strings as GuiStrings | null)?.[table]?.[String(id)] ?? fallback,
    screen: () => app.screen,
  };

  const placement = createPlacementController({
    ctx,
    container: bannerContainer,
    labelByType,
    enqueue,
    screenToTile: opts.screenToTile,
    tribe: opts.tribe,
    owner: opts.owner,
  });
  const menu = createMenuWindow({
    ctx,
    buildings: opts.buildings,
    labelByType,
    container: windowContainer,
    onPick: (typeId) => placement.enter(typeId),
  });
  const stats = createStatsWindow({ ctx, container: windowContainer });

  // --- The game-speed button ---------------------------------------------------------------------------
  let speedState: GameSpeedState = DEFAULT_GAME_SPEED_STATE;
  let speedRun: TextRun | null = null; // fallback glyph (the flat mode has no distinct per-state sprite)
  const speedBtnRect = layout.buttons.find((b) => b.id === 'speed')?.placed;

  const applySpeed = (pushToLoop: boolean): void => {
    const spec = gameSpeedSpec(speedState);
    if (speedSprite !== null && art !== null) {
      const frame = art.layer.atlas.frames.get(spec.gfx);
      if (frame !== undefined)
        speedSprite.setFrame(art.layer.source, frame, art.layer.atlas.width, art.layer.atlas.height);
    }
    if (art === null && speedBtnRect !== undefined) {
      speedRun?.destroy();
      speedRun = ctx.makeText(spec.state === 'paused' ? '||' : `x${spec.factor}`, 'white');
      stripContainer.addChild(speedRun.container);
      speedRun.place(
        speedBtnRect.x + SPEED_LABEL_INSET_X * scale,
        speedBtnRect.y + speedBtnRect.h / 2 - SPEED_LABEL_RAISE_Y * scale,
        scale,
        app.screen.width,
        app.screen.height,
      );
    }
    // Push to the loop only on an actual speed change (a button click), NOT at mount — the entry seeds its
    // own initial loop speed (default / `?speed=`), and the panel must not clobber it with ×1 before frame 0.
    if (pushToLoop) opts.onSpeedChange(spec);
  };

  // --- Button actions -------------------------------------------------------------------------------
  const activateButton = (id: ToolButtonId): void => {
    switch (id) {
      case 'speed':
        speedState = nextGameSpeedState(speedState);
        applySpeed(true);
        break;
      case 'buildings':
        placement.cancel();
        menu.toggle();
        break;
      case 'statistics':
      case 'help': // PLACEHOLDER alias: Help has no window yet, so it toggles Statistics for now.
        stats.toggle();
        break;
      default:
        // extras / mission / diplomacy / population / tech_tree / options — not wired in v1 (see plan).
        break;
    }
  };

  // --- Input --------------------------------------------------------------------------------------
  const toCanvas = (clientX: number, clientY: number): { x: number; y: number } => {
    const { sx, sy, rect } = opts.backingScale(canvas);
    return { x: (clientX - rect.left) * sx, y: (clientY - rect.top) * sy };
  };

  const claimsPointer = (clientX: number, clientY: number): boolean => {
    const { x, y } = toCanvas(clientX, clientY);
    if (pointOverToolPanel(layout, x, y)) return true;
    if (menu.claims(x, y)) return true;
    if (stats.claims(x, y)) return true;
    if (placement.isActive()) return true; // placement claims the whole canvas until placed/cancelled
    return false;
  };

  const onMouseDown = (e: MouseEvent): void => {
    const { x, y } = toCanvas(e.clientX, e.clientY);

    // Right button cancels an active placement; otherwise it's a world order (left to the unit controls).
    if (e.button === 2) {
      if (placement.isActive()) {
        e.preventDefault();
        // Stop the SAME event reaching unit-controls' mousedown (it re-checks claimPointer AFTER this
        // handler runs — cancel clears the claim, so without this the right-click would ALSO issue a
        // world move order). We register first (mounted before unit-controls), so this wins.
        e.stopImmediatePropagation();
        placement.cancel();
      }
      return;
    }
    if (e.button !== 0) return;

    // Track whether the panel CONSUMES this press; if so, stop it from also reaching world picking.
    // Priority: strip button > open menu > open stats (close-on-inside) > active placement drop.
    let consumed = false;
    const btn = hitTestToolPanel(layout, x, y);
    if (btn !== null) {
      activateButton(btn);
      consumed = true;
    } else {
      consumed = menu.handleClick(x, y);
    }
    if (!consumed) consumed = stats.handleClick(x, y);
    if (!consumed) consumed = placement.handleClick(e.clientX, e.clientY);
    if (consumed) e.stopImmediatePropagation();
  };

  let hover: ToolButtonId | null = null;
  const onMouseMove = (e: MouseEvent): void => {
    const { x, y } = toCanvas(e.clientX, e.clientY);
    const next = hitTestToolPanel(layout, x, y);
    if (next === hover) return;
    hover = next;
    hoverG.clear();
    if (hover !== null) {
      const rect = layout.buttons.find((b) => b.id === hover)?.placed;
      if (rect !== undefined)
        hoverG.rect(rect.x, rect.y, rect.w, rect.h).fill({ color: HOVER_TINT, alpha: HOVER_ALPHA });
    }
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Escape' && placement.isActive()) placement.cancel();
  };

  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  window.addEventListener('keydown', onKeyDown);

  applySpeed(false); // initialise the speed button graphic only — the loop keeps the entry's seeded speed

  return {
    claimsPointer,
    update(hud): void {
      const rw = app.screen.width;
      const rh = app.screen.height;
      for (const p of panelSprites) p.spr.place(p.rect.x, p.rect.y, scale, rw, rh);
      if (menu.isOpen()) menu.place();
      stats.refresh(hud);
      placement.placeBanner();
    },
    dispose(): void {
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('keydown', onKeyDown);
      root.destroy({ children: true });
    },
  };
}
