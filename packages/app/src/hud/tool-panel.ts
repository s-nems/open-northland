import { type HudLayout, PalettedSprite, type SpriteLayer } from '@vinland/render';
import type { Command } from '@vinland/sim';
import { type Application, Container, Graphics, Text } from 'pixi.js';
import {
  type FontColorName,
  fontColorRow,
  loadFontColorLut,
  loadFontIndexed,
  loadFontMetrics,
} from '../content/font-gfx.js';
import { GUI_FRAMES } from '../content/gui-atlas-map.js';
import {
  type GuiPaletteName,
  type GuiStrings,
  guiPaletteRow,
  loadGuiPaletteLut,
  loadGuiStrings,
  loadGuiWindowIndexed,
} from '../content/gui-gfx.js';
import { type BitmapFont, createBitmapTextRun } from './bitmap-text.js';
import {
  type BuildingCategory,
  type BuildingMenuLayout,
  type MenuBuildingEntry,
  hitTestBuildingMenu,
  layoutBuildingMenu,
} from './building-menu.js';
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
} from './tool-panel-layout.js';

/**
 * The LEFT in-game tool panel — the retained screen-space HUD that draws the original toolbar strip, the
 * tool buttons, the working game-speed button, and the pop-up building / statistics windows, and claims the
 * clicks that land on it (so they never fall through to world picking).
 *
 * Rendering: strip/buttons/speed draw as {@link PalettedSprite}s over the indexed `ls_gui_window` atlas,
 * coloured through the GUI palette LUT (the same mechanism as player colours) — bitmap-native, no DOM. When
 * the decoded GUI art is absent (a checkout that hasn't run the GUI pipeline stage) the panel DEGRADES to
 * flat `Graphics` blocks at the exact same pinned geometry, staying visible and fully interactive; the
 * pop-up window chrome is a parchment `Graphics` panel in both modes (a sprite 9-slice is a follow-up, see
 * docs/ROADMAP.md). Text is the decoded `.fnt` bitmap font when present, else a Pixi `Text` fallback.
 *
 * The pure geometry / speed-state / menu logic lives in the sibling `tool-panel-layout` / `game-speed` /
 * `building-menu` modules (headlessly unit-tested); this module is only the Pixi + input glue.
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
  /** The current game-speed spec (so the entry can initialise its loop control before the first frame). */
  speed(): GameSpeedStateSpec;
  dispose(): void;
}

/** The UI bitmap font the panel draws text with (font10 is the standard in-game body font). */
const DEFAULT_FONT_KEY = 'font10';
/** Fallback (no-`.fnt`) text size in design px, scaled by uiscale — kept legible inside the scaled row rects. */
const FALLBACK_TEXT_PX = 9;
const FALLBACK_COLORS: Readonly<Record<FontColorName, string>> = {
  white: '#f2ead6',
  dark: '#2a2118',
  dimmed: '#9a8f78',
  red: '#c8503c',
};

/** Parchment window chrome (a `Graphics` panel in both render modes). */
const WINDOW_FILL = 0x241d12;
const WINDOW_BORDER = 0x6b5836;
const HOVER_TINT = 0xffffff;
const HOVER_ALPHA = 0.16;
/** Fallback strip / button block colours (only used when the decoded GUI art is absent). */
const FALLBACK_STRIP = 0x1c1810;
const FALLBACK_BUTTON = 0x4a3f28;
const FALLBACK_BUTTON_BORDER = 0x8a744a;

/** Design-space padding/rows for the pop-up windows (scaled by uiscale, like the strip). */
const WIN_PAD = 6;
const WIN_TITLE_H = 16;
const WIN_LINE_H = 12;
const STATS_WIDTH = 150;

/** A re-placeable line of text — a bitmap-font run when the `.fnt` is loaded, else a Pixi `Text`. */
interface TextRun {
  readonly container: Container;
  place(x: number, y: number, scale: number, resWidth: number, resHeight: number): void;
  destroy(): void;
}

/** Load the standard UI bitmap font (indexed atlas + colour LUT + metrics), or `null` if the pipeline hasn't run. */
async function loadBitmapFont(key: string): Promise<BitmapFont | null> {
  try {
    const [layer, lut, metrics] = await Promise.all([
      loadFontIndexed(key).catch(() => null),
      loadFontColorLut(),
      loadFontMetrics(key),
    ]);
    if (layer === null || lut === undefined || metrics === null) return null;
    return { layer, metrics, lut, colours: lut.pixelHeight };
  } catch {
    return null;
  }
}

const paletteOfFrame = (gfx: number): GuiPaletteName => GUI_FRAMES[gfx]?.palette ?? 'iconsleft';

function within(r: PlacedRect, x: number, y: number): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

/**
 * Mount the tool panel onto the app stage. Async because it loads the (optional) decoded GUI art + font;
 * everything degrades gracefully so a checkout without `content/` still boots and the panel stays usable.
 */
export async function mountToolPanel(opts: ToolPanelOptions): Promise<ToolPanelController> {
  const { app, canvas, enqueue } = opts;
  const layout = buildToolPanelLayout(opts.uiscale);
  const scale = layout.scale;

  const [guiLayer, guiLut, strings, font] = await Promise.all([
    loadGuiWindowIndexed().catch<SpriteLayer | null>(() => null),
    loadGuiPaletteLut().then((t) => t ?? null),
    loadGuiStrings(opts.lang),
    loadBitmapFont(DEFAULT_FONT_KEY),
  ]);
  const hasArt = guiLayer !== null && guiLut !== null;
  const guiColours = guiLut?.pixelHeight ?? 1;

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

  // A GUI-atlas sprite for one frame, or `null` if the art / frame is missing.
  const guiSprite = (gfx: number): PalettedSprite | null => {
    if (!hasArt || guiLayer === null || guiLut === null) return null;
    const frame = guiLayer.atlas.frames.get(gfx);
    if (frame === undefined) return null;
    const spr = new PalettedSprite(guiLut, guiColours);
    spr.setFrame(guiLayer.source, frame, guiLayer.atlas.width, guiLayer.atlas.height);
    spr.player = guiPaletteRow(paletteOfFrame(gfx));
    return spr;
  };

  // --- The strip + buttons (real sprites, or a flat-Graphics fallback) ------------------------------
  const panelSprites: { readonly spr: PalettedSprite; readonly rect: PlacedRect }[] = [];
  let speedSprite: PalettedSprite | null = null;

  if (hasArt) {
    const strip = guiSprite(layout.stripGfx);
    if (strip !== null) {
      stripContainer.addChild(strip);
      panelSprites.push({ spr: strip, rect: layout.strip });
    }
    for (const b of layout.buttons) {
      const spr = guiSprite(b.gfx);
      if (spr === null) continue;
      stripContainer.addChild(spr);
      panelSprites.push({ spr, rect: b.placed });
      if (b.id === 'speed') speedSprite = spr;
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

  // --- Text factory (bitmap font, else Pixi Text) ---------------------------------------------------
  const makeText = (text: string, color: FontColorName): TextRun => {
    if (font !== null) return createBitmapTextRun(font, text, fontColorRow(color));
    const t = new Text({
      text,
      style: { fill: FALLBACK_COLORS[color], fontSize: FALLBACK_TEXT_PX * scale, fontFamily: 'sans-serif' },
    });
    const container = new Container();
    container.addChild(t);
    return {
      container,
      place: (x, y) => container.position.set(x, y),
      destroy: () => container.destroy({ children: true }),
    };
  };

  /** Prefer the decoded UI string for `(table, id)`, else the pinned fallback label. */
  const uiString = (table: string, id: number, fallback: string): string =>
    (strings as GuiStrings | null)?.[table]?.[String(id)] ?? fallback;

  // --- State ----------------------------------------------------------------------------------------
  let speedState: GameSpeedState = DEFAULT_GAME_SPEED_STATE;
  let hover: ToolButtonId | null = null;
  let menuOpen = false;
  let menuCategory: BuildingCategory = 'all';
  let menuLayout: BuildingMenuLayout | null = null;
  const menuRuns: TextRun[] = [];
  const menuGraphics = new Graphics();
  windowContainer.addChild(menuGraphics);
  let statsOpen = false;
  let statsKey = '';
  /** The stats window's ACTUAL drawn rect — the single source of truth for its hit region + close-on-outside. */
  let statsRect: PlacedRect | null = null;
  const statsRuns: TextRun[] = [];
  const statsGraphics = new Graphics();
  windowContainer.addChild(statsGraphics);
  let placementType: number | null = null;
  const bannerGraphics = new Graphics();
  bannerContainer.addChild(bannerGraphics);
  let bannerRun: TextRun | null = null;

  // Fallback speed indicator (the flat mode has no distinct per-state sprite).
  const speedLabel = hasArt ? null : makeText('', 'white');
  if (speedLabel !== null) stripContainer.addChild(speedLabel.container);

  const speedBtnRect = layout.buttons.find((b) => b.id === 'speed')?.placed;

  const applySpeed = (): void => {
    const spec = gameSpeedSpec(speedState);
    if (speedSprite !== null && guiLayer !== null) {
      const frame = guiLayer.atlas.frames.get(spec.gfx);
      if (frame !== undefined)
        speedSprite.setFrame(guiLayer.source, frame, guiLayer.atlas.width, guiLayer.atlas.height);
    }
    if (speedLabel !== null && speedBtnRect !== undefined) {
      const glyph = spec.state === 'paused' ? '||' : `x${spec.factor}`;
      for (const c of speedLabel.container.removeChildren()) c.destroy();
      const t = new Text({ text: glyph, style: { fill: '#f2ead6', fontSize: FALLBACK_TEXT_PX * scale } });
      speedLabel.container.addChild(t);
      speedLabel.container.position.set(
        speedBtnRect.x + 4 * scale,
        speedBtnRect.y + speedBtnRect.h / 2 - 3 * scale,
      );
    }
    opts.onSpeedChange(spec);
  };

  // --- Building menu --------------------------------------------------------------------------------
  const clearMenu = (): void => {
    for (const r of menuRuns) r.destroy();
    menuRuns.length = 0;
    menuGraphics.clear();
  };

  const rebuildMenu = (): void => {
    clearMenu();
    const originX = layout.width + WIN_PAD * scale;
    const originY = layout.strip.y;
    menuLayout = layoutBuildingMenu(opts.buildings, { originX, originY, scale, selected: menuCategory });
    const w = menuLayout.window;
    menuGraphics
      .rect(w.x, w.y, w.w, w.h)
      .fill(WINDOW_FILL)
      .stroke({ color: WINDOW_BORDER, width: Math.max(1, scale) });

    // Draw the close affordance (an X in a box) so the top-right close hot-region is visible.
    const cr = menuLayout.closeRect;
    const cm = Math.max(2, 2 * scale);
    menuGraphics
      .rect(cr.x, cr.y, cr.w, cr.h)
      .fill({ color: 0x000000, alpha: 0.3 })
      .stroke({ color: WINDOW_BORDER, width: Math.max(1, scale) })
      .moveTo(cr.x + cm, cr.y + cm)
      .lineTo(cr.x + cr.w - cm, cr.y + cr.h - cm)
      .moveTo(cr.x + cr.w - cm, cr.y + cm)
      .lineTo(cr.x + cm, cr.y + cr.h - cm)
      .stroke({ color: 0xd8ccb0, width: Math.max(1, scale) });

    const title = makeText(uiString('miscwindow', 0, 'Zbuduj Okno'), 'white');
    windowContainer.addChild(title.container);
    menuRuns.push(title);

    for (const tab of menuLayout.tabs) {
      if (tab.selected) {
        menuGraphics
          .rect(tab.rect.x, tab.rect.y, tab.rect.w, tab.rect.h)
          .fill({ color: HOVER_TINT, alpha: 0.14 });
      }
      const run = makeText(
        uiString('miscwindow', tab.stringId, tab.label),
        tab.selected ? 'white' : 'dimmed',
      );
      windowContainer.addChild(run.container);
      menuRuns.push(run);
    }
    for (const row of menuLayout.rows) {
      const run = makeText(labelByType.get(row.typeId) ?? `#${row.typeId}`, 'white');
      windowContainer.addChild(run.container);
      menuRuns.push(run);
    }
  };

  const placeMenu = (rw: number, rh: number): void => {
    if (menuLayout === null) return;
    // menuRuns order: [title, ...tabs, ...rows]
    let i = 0;
    menuRuns[i++]?.place(menuLayout.titleRect.x, menuLayout.titleRect.y + 2 * scale, scale, rw, rh);
    for (const tab of menuLayout.tabs)
      menuRuns[i++]?.place(tab.rect.x + 3 * scale, tab.rect.y + 2 * scale, scale, rw, rh);
    for (const row of menuLayout.rows)
      menuRuns[i++]?.place(row.rect.x + 2 * scale, row.rect.y + 1 * scale, scale, rw, rh);
  };

  const openMenu = (): void => {
    menuOpen = true;
    rebuildMenu();
    placeMenu(app.screen.width, app.screen.height);
  };
  const closeMenu = (): void => {
    menuOpen = false;
    clearMenu();
  };

  // --- Statistics window ----------------------------------------------------------------------------
  const clearStats = (): void => {
    for (const r of statsRuns) r.destroy();
    statsRuns.length = 0;
    statsGraphics.clear();
    statsRect = null;
  };

  const statsOrigin = (): { x: number; y: number } => ({
    x: layout.width + (WIN_PAD + STATS_WIDTH + 3 * WIN_PAD) * scale,
    y: layout.strip.y + 15 * scale,
  });

  const rebuildStats = (rows: readonly string[]): void => {
    clearStats();
    const { x: ox, y: oy } = statsOrigin();
    const w = STATS_WIDTH * scale;
    const h = (WIN_TITLE_H + rows.length * WIN_LINE_H + WIN_PAD) * scale;
    statsRect = { x: ox, y: oy, w, h };
    statsGraphics
      .rect(ox, oy, w, h)
      .fill(WINDOW_FILL)
      .stroke({ color: WINDOW_BORDER, width: Math.max(1, scale) });
    const title = makeText(uiString('miscwindow', 180, 'Statystyki'), 'white');
    windowContainer.addChild(title.container);
    statsRuns.push(title);
    for (const text of rows) {
      const run = makeText(text, 'white');
      windowContainer.addChild(run.container);
      statsRuns.push(run);
    }
    placeStats(app.screen.width, app.screen.height);
  };

  const placeStats = (rw: number, rh: number): void => {
    const { x: ox, y: oy } = statsOrigin();
    const pad = WIN_PAD * scale;
    let i = 0;
    statsRuns[i++]?.place(ox + pad, oy + 2 * scale, scale, rw, rh);
    for (let r = 0; r < statsRuns.length - 1; r++) {
      statsRuns[i++]?.place(ox + pad, oy + (WIN_TITLE_H + r * WIN_LINE_H) * scale, scale, rw, rh);
    }
  };

  const refreshStats = (hud: HudLayout): void => {
    const rows = hud.rows.map((r) => r.text);
    // Change-detection key EXCLUDES the volatile tick line (`layoutHud` row 0 is `Tribe N · tick T`): the
    // tick advances every frame, so keying on it would defeat the guard and rebuild the ~hundreds of glyph
    // meshes each frame. Rebuild only when a TALLY (population/jobs/stocks) actually changes; the displayed
    // tick then refreshes on that rebuild.
    const key = rows.filter((t) => !t.includes('tick')).join('|');
    if (key === statsKey) return;
    statsKey = key;
    rebuildStats(rows);
  };

  const closeStats = (): void => {
    statsOpen = false;
    statsKey = '';
    clearStats();
  };

  // --- Placement mode -------------------------------------------------------------------------------
  const enterPlacement = (typeId: number): void => {
    placementType = typeId;
    closeMenu();
    bannerGraphics.clear();
    bannerRun?.destroy();
    const label = labelByType.get(typeId) ?? `#${typeId}`;
    const w = 260 * scale;
    const h = (WIN_TITLE_H + WIN_PAD) * scale;
    const x = layout.width + WIN_PAD * scale;
    const y = 2 * scale;
    bannerGraphics
      .rect(x, y, w, h)
      .fill(WINDOW_FILL)
      .stroke({ color: WINDOW_BORDER, width: Math.max(1, scale) });
    bannerRun = makeText(`${label} - klik: postaw, Esc: anuluj`, 'white');
    bannerContainer.addChild(bannerRun.container);
    bannerRun.place(x + WIN_PAD * scale, y + 3 * scale, scale, app.screen.width, app.screen.height);
  };
  const cancelPlacement = (): void => {
    placementType = null;
    bannerGraphics.clear();
    bannerRun?.destroy();
    bannerRun = null;
  };

  // --- Button actions -------------------------------------------------------------------------------
  const activateButton = (id: ToolButtonId): void => {
    switch (id) {
      case 'speed':
        speedState = nextGameSpeedState(speedState);
        applySpeed();
        break;
      case 'buildings':
        cancelPlacement();
        if (menuOpen) closeMenu();
        else openMenu();
        break;
      case 'statistics':
      case 'help':
        if (statsOpen) closeStats();
        else statsOpen = true;
        break;
      default:
        // extras / mission / diplomacy / population / tech_tree / options — not wired in v1 (see ROADMAP).
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
    if (menuOpen && menuLayout !== null && within(menuLayout.window, x, y)) return true;
    if (statsOpen && statsRect !== null && within(statsRect, x, y)) return true;
    if (placementType !== null) return true; // placement claims the whole canvas until placed/cancelled
    return false;
  };

  const onMouseDown = (e: MouseEvent): void => {
    const { x, y } = toCanvas(e.clientX, e.clientY);

    // Right button cancels an active placement; otherwise it's a world order (left to the unit controls).
    if (e.button === 2) {
      if (placementType !== null) {
        e.preventDefault();
        // Stop the SAME event reaching unit-controls' mousedown (it re-checks claimPointer AFTER this
        // handler runs — cancelPlacement clears the claim, so without this the right-click would ALSO
        // issue a world move order). We register first (mounted before unit-controls), so this wins.
        e.stopImmediatePropagation();
        cancelPlacement();
      }
      return;
    }
    if (e.button !== 0) return;

    // Track whether the panel CONSUMES this press; if so, stop it from also reaching world picking.
    let consumed = false;
    const btn = hitTestToolPanel(layout, x, y);
    if (btn !== null) {
      activateButton(btn);
      consumed = true;
    } else if (menuOpen && menuLayout !== null) {
      const hit = hitTestBuildingMenu(menuLayout, x, y);
      if (hit !== null) {
        if (hit.kind === 'close') closeMenu();
        else if (hit.kind === 'tab') {
          menuCategory = hit.category;
          rebuildMenu();
          placeMenu(app.screen.width, app.screen.height);
        } else if (hit.kind === 'building') enterPlacement(hit.typeId);
        // 'window' → consumed, no-op
        consumed = true;
      }
    }
    // A click strictly INSIDE the stats window closes it (v1 has no window chrome controls). Checked only
    // when the click wasn't a menu/button hit, so it doesn't fire for a placement click over the world.
    if (!consumed && statsOpen && statsRect !== null && within(statsRect, x, y)) {
      closeStats();
      consumed = true;
    }
    if (!consumed && placementType !== null) {
      const tile = opts.screenToTile(e.clientX, e.clientY);
      if (tile !== null) {
        enqueue({
          kind: 'placeBuilding',
          buildingType: placementType,
          x: tile.col,
          y: tile.row,
          tribe: opts.tribe,
          owner: opts.owner,
        });
      }
      // Placement claims the click whether or not the tile is on-map; stay in placement for repeats
      // (Esc / right-click / the Buildings button exit).
      consumed = true;
    }
    if (consumed) e.stopImmediatePropagation();
  };

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
    if (e.code === 'Escape' && placementType !== null) cancelPlacement();
  };

  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  window.addEventListener('keydown', onKeyDown);

  applySpeed(); // initialise the speed button graphic + push the initial speed to the loop

  return {
    claimsPointer,
    speed: () => gameSpeedSpec(speedState),
    update(hud): void {
      const rw = app.screen.width;
      const rh = app.screen.height;
      for (const p of panelSprites) p.spr.place(p.rect.x, p.rect.y, scale, rw, rh);
      if (menuOpen) placeMenu(rw, rh);
      if (statsOpen) refreshStats(hud);
      if (bannerRun !== null) bannerRun.place(layout.width + WIN_PAD * scale, 5 * scale, scale, rw, rh);
    },
    dispose(): void {
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('keydown', onKeyDown);
      root.destroy({ children: true });
    },
  };
}
