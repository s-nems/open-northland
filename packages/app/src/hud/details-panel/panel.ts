import {
  createReusableBaker,
  type PortraitInsetFrame,
  type SpriteSheet,
  type SupersampledTexture,
} from '@open-northland/render';
import type { WorldSnapshot } from '@open-northland/sim';
import { type Application, Container, Graphics } from 'pixi.js';
import { uiStringLookup } from '../../content/gui-gfx.js';
import { contains, type Rect } from '../geometry.js';
import { loadDetailsPanelAssets } from './assets.js';
import { createChrome, type PanelLayers } from './chrome.js';
import { hitButton, hitCraftChoice, hitGatherChoice, hitStockTab, tooltipTextAt } from './hit-test.js';
import { type ButtonHit, mapLayout, ROW_H } from './layout/index.js';
import { buildUnitPanelModel, type UnitPanelModel, type UnitPanelModelContext } from './model/index.js';
import { drawBuilding, drawCompact, drawSettler, drawSignpost } from './sections/index.js';
import { EMPTY_PANEL_VIEW, type PanelView, panelViewFor } from './selection-view.js';
import { ALL_STOCK_TAB } from './stock-tabs.js';
import { WorkerSpriteOverlay } from './worker-sprites.js';

/**
 * The bottom-right selection details panel (the original's per-selection window stack: general/defence/
 * production/stock/workers for a building, the info card for a settler), drawn as Pixi HUD from the
 * extracted original art. `model.ts` decides what is shown, `layout.ts` where, `sections.ts`+`chrome.ts`
 * how — this module wires them to the app: loading, selection/tick updates, pointer claims, and clicks.
 */

/** Above the world and the left tool panel, below nothing (the panel is the outermost HUD layer). */
const PANEL_Z = 1002;

/**
 * The portrait box the live world "observation window" fills — the panel's preview rect, in on-screen px,
 * shrunk by the bevel so the cutout sits inside the inner-box frame rather than over it. Both the settler
 * (Ogólne) and building (Ogólny) layouts expose a `preview`; the view renders the world into this rect and
 * centres it on {@link PortraitBox.entityRef}. Null when the current selection has no portrait.
 */
export type PortraitBox = PortraitInsetFrame;
/** Bevel inset (design px) so the observation window sits inside the portrait box's frame, not over it. */
const PORTRAIT_BEVEL_INSET = 3;

/**
 * Minimum wall-clock gap between value-driven rebuilds. Live values (production %, need bars, status
 * countdowns) change nearly every sim tick; rebuilding the retained tree 20×/s is pure churn, and 4 Hz
 * is indistinguishable on a ~100-px bar. Selection changes rebuild immediately.
 */
const VALUE_REBUILD_MIN_MS = 250;

export interface UnitPanelOptions extends UnitPanelModelContext {
  readonly app: Application;
  readonly canvas: HTMLCanvasElement;
  /** Integer UI scale (from `?uiscale=`), shared with the left tool panel and action ring. */
  readonly uiscale?: number;
  readonly lang: string;
  /** Client→canvas coordinate mapping, injected like the tool panel's (the hud layer stays view-free). */
  readonly backingScale: (canvas: HTMLCanvasElement) => { sx: number; sy: number; rect: DOMRect };
  readonly onDemolish: (entityId: number) => void;
  /** Begin upgrading the selected building into its next level — the Upgrade button (housewindow 110). */
  readonly onUpgrade: (entityId: number) => void;
  /** Abort the selected building's running upgrade — the Cancel button (housewindow 112). */
  readonly onCancelUpgrade: (entityId: number) => void;
  /** Tear down the selected signpost — invoked by the signpost panel's one button. */
  readonly onDemolishSignpost: (entityId: number) => void;
  /** Enter "assign a workplace" mode for the selected settler — invoked when the player clicks the Praca
   *  section's assign button. The view then highlights candidate buildings and binds the settler to the one
   *  the next left-click hits. Absent → the button is inert. */
  readonly onAssignWorkplace?: (settlerId: number) => void;
  /** Enter "assign a home" mode for the selected settler — the residential twin of
   *  {@link onAssignWorkplace} (the view washes candidate homes green/red). Absent → the button is inert. */
  readonly onAssignHome?: (settlerId: number) => void;
  /** Remove the selected settler's family from its home (the `unassignHouse` command) — the inverse of
   *  {@link onAssignHome}. No pick mode: it acts on the current home immediately. Absent → button inert. */
  readonly onUnassignHome?: (settlerId: number) => void;
  readonly onSetGatherGood: (entityId: number, goodType: number | null) => void;
  /** Replace a craft worker's product selection (the `setCraftGoods` command); `[]` = every product.
   *  The panel computes the toggled set from the clicked button + the model's effective selection. */
  readonly onSetCraftGoods: (entityId: number, goods: readonly number[]) => void;
  /** The loaded sprite sheet, so the workers field can draw its bound workers as animated on-map sprites.
   *  Absent (a bare checkout / headless test) → the field just stays empty. */
  readonly sheet?: SpriteSheet;
  /** Owner slot → team-colour slot for the worker sprites (a map roster's colour choices); absent =
   *  identity, matching the world renderer's default. */
  readonly playerColourOf?: (player: number) => number;
  /** Select this entity — invoked when the player clicks a worker sprite in the Pracownicy field, so it
   *  selects that settler (dropping the building), exactly like clicking the worker on the map. */
  readonly onSelectEntity?: (entityId: number) => void;
  /** A cursor tooltip to name the hovered Magazyn stock row — injected (structural shape) like
   *  `backingScale`, so the hud layer never imports the view-layer element. Absent → no stock-row tooltip. */
  readonly tooltip?: {
    show(clientX: number, clientY: number, text: string): void;
    hide(): void;
  };
}

export interface UnitPanel {
  /** Rebuild the details panel for a new selection. */
  render(snapshot: WorldSnapshot, selected: ReadonlySet<number>): void;
  /** Refresh the details panel from the current snapshot. */
  tick(snapshot: WorldSnapshot): void;
  /** True when a client point is over the details panel. */
  claimsPointer(clientX: number, clientY: number): boolean;
  /** The portrait box the live world observation window fills (rect + entity to centre on), or null when
   *  the current selection has no portrait (multi-select, empty). Read each frame by the view. */
  portrait(): PortraitBox | null;
  /**
   * Route a mousedown: true when the point is over the panel (the caller must not world-pick it);
   * a left press on an enabled button performs its action. Part of the unit-controls claim chain.
   * `toggleModifier` (Ctrl/Cmd held) switches a craft-choice click from replace-selection to toggle.
   */
  handleMouseDown(clientX: number, clientY: number, button: number, toggleModifier?: boolean): boolean;
  dispose(): void;
}

export async function mountUnitPanel(opts: UnitPanelOptions): Promise<UnitPanel> {
  const { app, canvas } = opts;
  // Fractional display scale (shared with the tool panel / action ring); the panel's PalettedSprite chrome
  // (indexed atlas, nearest-sampled) can't be linearly filtered, so a fractional scale would double texel
  // columns unevenly ("pixeloza") — instead it bakes at an integer oversample and linear-downscales to this.
  const scale = Math.max(1, opts.uiscale ?? 1);
  // The panel carries the finest text in the HUD (a native-11px body font at a fractional scale). Unlike
  // the tool-panel strip (icons — a device-aware `oversampleFor` is enough), a 2× bake linear-downscaled to
  // a fractional scale still hazes small glyph edges, so text legibility wins: at a fractional scale bake at
  // the max oversample (crispest downscale). An integer scale needs no supersample at all — nearest is
  // already exact, so keep it 1:1 rather than needlessly softening a pixel-perfect render. (This panel's
  // policy differs from the shared `oversampleFor` — which always targets ≥2× for AA — so it decides here.)
  const PANEL_MAX_SUPERSAMPLE = 4;
  const ss = Number.isInteger(scale) && scale <= PANEL_MAX_SUPERSAMPLE ? scale : PANEL_MAX_SUPERSAMPLE;
  const assets = await loadDetailsPanelAssets(opts.lang);
  const uiString = uiStringLookup(assets.strings);

  let root = new Container();
  root.zIndex = PANEL_Z;
  root.visible = false;
  app.stage.addChild(root);
  /** The current rebuild's baked panel texture; disposed and replaced on the next rebuild. */
  let baked: SupersampledTexture | null = null;
  // One shared bake target for every rebuild: a fresh render texture per rebuild would blank the
  // portrait inset's world cutout for a frame — the preview blinking at every construction hammer
  // hit (see createReusableBaker).
  const baker = createReusableBaker(app.renderer);
  // The animated worker sprites drawn live over the baked panel's Pracownicy field (one z above it), so
  // they advance every frame while the panel itself re-bakes at most 4 Hz.
  const workerOverlay = new WorkerSpriteOverlay(app, opts.sheet, PANEL_Z + 1, opts.playerColourOf);

  const ctx: UnitPanelModelContext = {
    buildings: opts.buildings,
    goods: opts.goods,
    jobs: opts.jobs,
  };

  let selectedIds: ReadonlySet<number> = new Set();
  /** Bumped by every rebuild: the model + layout the worker overlay reads change only there. */
  let panelEpoch = 0;
  let lastModelKey = '';
  let lastStructureKey = '';
  let lastRebuildAt = Number.NEGATIVE_INFINITY;
  let view: PanelView = EMPTY_PANEL_VIEW;
  let hoverAction: ButtonHit['action'] | null = null;
  let hoveredGatherGood: number | null | undefined;
  /** The last known cursor position over the canvas (client coords), or null after it left — lets a
   *  rebuild refresh a still cursor's tooltip with live values (a held hover must not show a stale
   *  "80%" while the bar drains; user feedback 2026-07-11). */
  let lastPointer: { clientX: number; clientY: number } | null = null;
  /** The selected stock tab ("Wszystkie" + the eight categories); every new selection opens on the
   *  "Wszystkie" view (held goods, fullest first) so a general store shows its contents at a glance. */
  let activeStockTab = ALL_STOCK_TAB;

  /** Fresh draw-order layers over an off-screen container (baked to a texture): fills, graphics, frames, glyphs. */
  const makeLayers = (into: Container): PanelLayers => {
    const g = new Graphics();
    const back = new Container();
    const front = new Container();
    const text = new Container();
    into.addChild(back, g, front, text);
    return { g, back, front, text };
  };

  const rebuild = (model: UnitPanelModel): void => {
    panelEpoch++;
    baked?.dispose();
    baked = null;
    root.destroy({ children: true });
    root = new Container();
    root.zIndex = PANEL_Z;
    app.stage.addChild(root);
    lastRebuildAt = performance.now();
    // Hit layout: the real screen-anchored geometry at the fractional display scale (pointer claims, buttons).
    view = panelViewFor(model, app.screen, scale);
    if (view.kind === 'empty') {
      root.visible = false;
      return;
    }
    root.visible = true;

    // Draw layout: the hit layout scaled by the oversample/display ratio and re-origined to (0,0), so it
    // fills a tight off-screen texture drawn at `ss`. Deriving it from the hit layout (rather than a second
    // layout pass at `ss`) keeps the drawn geometry equal to the hit-tested geometry — two independent
    // roundings at different scales would drift ~1 px and accumulate down the button column.
    const k = ss / scale;
    const origin = view.layout.panel;
    const toDraw = (r: Rect): Rect => ({
      x: (r.x - origin.x) * k,
      y: (r.y - origin.y) * k,
      w: r.w * k,
      h: r.h * k,
    });
    const texW = Math.max(1, Math.round(view.layout.panel.w * k));
    const texH = Math.max(1, Math.round(view.layout.panel.h * k));

    const offscreen = new Container();
    const chrome = createChrome(assets, app, ss, makeLayers(offscreen), { w: texW, h: texH });
    switch (view.kind) {
      case 'building': {
        const draw = mapLayout(view.layout, toDraw);
        drawBuilding(chrome, draw, view.model, uiString, hoverAction, activeStockTab, ss);
        break;
      }
      case 'settler': {
        const draw = mapLayout(view.layout, toDraw);
        drawSettler(chrome, draw, view.model, uiString, hoverAction, hoveredGatherGood, ss);
        break;
      }
      case 'compact':
        drawCompact(chrome, mapLayout(view.layout, toDraw), view.model, uiString, ss);
        break;
      case 'signpost':
        drawSignpost(chrome, mapLayout(view.layout, toDraw), uiString, hoverAction);
        break;
    }

    // Mixed source (Pixi-native fills/preview + flipY PalettedSprites), so it bakes upright — display
    // unflipped, anchored at the panel's screen top-left.
    const texture = baker.bake(offscreen, texW, texH, scale / ss);
    texture.display.position.set(view.layout.panel.x, view.layout.panel.y);
    root.addChild(texture.display);
    baked = texture;
    // A rebuild changes what a held cursor hovers (a draining bar's value, a re-sorted stock row) — the
    // cursor itself won't move to fire a mousemove, so refresh the tooltip here. Rebuilds are already
    // rate-limited (VALUE_REBUILD_MIN_MS), so this adds no per-frame work.
    if (lastPointer !== null) updateTooltip(lastPointer.clientX, lastPointer.clientY);
  };

  /**
   * The model derived for one sim tick, with its value key. `buildUnitPanelModel` is a pure function of the
   * snapshot + selection, but `tick()` runs every RAF frame (~3 per 20 Hz sim tick) and the build is an
   * O(entities) pass — so it runs once per tick and the frames in between reuse it (golden rule 6). A new
   * selection re-derives through `force`; the wall-clock rebuild gate below still runs every frame, so a
   * rebuild the 4 Hz limit deferred still fires on a later frame of the same tick.
   *
   * Keyed on snapshot IDENTITY, not `snapshot.tick`: the sim memoizes `snapshot()` on tick + world
   * mutation version, so a same-tick world mutation hands out a new object under an unchanged tick — and
   * while paused the tick never advances to heal a stale model.
   */
  let derived: { snapshot: WorldSnapshot; model: UnitPanelModel; json: string } | null = null;

  const modelFor = (snapshot: WorldSnapshot, force: boolean): { model: UnitPanelModel; json: string } => {
    if (!force && derived !== null && derived.snapshot === snapshot) return derived;
    const model = buildUnitPanelModel(snapshot, selectedIds, ctx);
    derived = { snapshot, model, json: JSON.stringify(model) };
    return derived;
  };

  const updateModel = (snapshot: WorldSnapshot, force = false): void => {
    const { model, json } = modelFor(snapshot, force);
    // A whole-model value key (plus the screen size, so a resize re-anchors the panel): the panel is
    // small, so stringify-compare beats hand-written dirty flags.
    const key = `${json}|${app.screen.width}x${app.screen.height}`;
    if (!force && key === lastModelKey) return;
    // What is selected changed → rebuild now; only live values drifted → rebuild at most 4 Hz.
    const structureKey =
      model.kind === 'building' || model.kind === 'settler' || model.kind === 'signpost'
        ? `${model.kind}:${model.entityId}`
        : model.kind;
    const structural = force || structureKey !== lastStructureKey;
    if (!structural && performance.now() - lastRebuildAt < VALUE_REBUILD_MIN_MS) return;
    // A new selection opens the stock view on "Wszystkie" — never an empty tab, and a general store
    // reads its actual contents immediately.
    if (structural) activeStockTab = ALL_STOCK_TAB;
    lastModelKey = key;
    lastStructureKey = structureKey;
    rebuild(model);
  };

  const toCanvas = (clientX: number, clientY: number): { x: number; y: number } => {
    const { sx, sy, rect } = opts.backingScale(canvas);
    return { x: (clientX - rect.left) * sx, y: (clientY - rect.top) * sy };
  };

  /**
   * The next selection after a craft-choice click. A plain click REPLACES the selection with just the
   * clicked product (the RTS radio-button default); a Ctrl/Cmd click TOGGLES it in the multi-set
   * (user decision 2026-07-16). The toggle normalizes both edges — all products selected reads as the
   * `[]` all-mode (so the sim drops the component), and toggling the LAST product off falls back to
   * all-mode too (a worker can't craft nothing).
   */
  const nextCraftGoods = (
    model: Extract<UnitPanelModel, { kind: 'settler' }>,
    goodType: number,
    toggle: boolean,
  ): readonly number[] => {
    const products = model.work.craftChoices.map((c) => c.goodType);
    if (!toggle) return products.length === 1 ? [] : [goodType];
    const next = new Set(model.work.selectedCraftGoods);
    if (next.has(goodType)) next.delete(goodType);
    else next.add(goodType);
    if (next.size === 0 || next.size === products.length) return [];
    return products.filter((g) => next.has(g));
  };

  const claimsPointer = (clientX: number, clientY: number): boolean => {
    if (view.kind === 'empty') return false;
    const { x, y } = toCanvas(clientX, clientY);
    return contains(view.layout.panel, x, y);
  };

  const handleMouseDown = (
    clientX: number,
    clientY: number,
    button: number,
    toggleModifier = false,
  ): boolean => {
    if (!claimsPointer(clientX, clientY)) return false;
    if (button !== 0) return true; // over the panel — swallow, but only the left button acts
    const { x, y } = toCanvas(clientX, clientY);
    // A click on a worker sprite selects that settler (like clicking it on the map) — before tabs/buttons.
    const worker = workerOverlay.hitTest(x, y);
    if (worker !== null) {
      opts.onSelectEntity?.(worker);
      return true;
    }
    if (view.kind === 'settler') {
      const gatherGood = hitGatherChoice(view, x, y);
      if (gatherGood !== undefined) {
        opts.onSetGatherGood(view.model.entityId, gatherGood);
        return true;
      }
      const craftGood = hitCraftChoice(view, x, y);
      if (craftGood !== undefined) {
        opts.onSetCraftGoods(view.model.entityId, nextCraftGoods(view.model, craftGood, toggleModifier));
        return true;
      }
    }
    if (view.kind === 'building') {
      const tab = hitStockTab(view, x, y);
      if (tab !== null) {
        if (tab !== activeStockTab) {
          activeStockTab = tab;
          rebuild(view.model);
        }
        return true;
      }
    }
    const hit = hitButton(view, x, y);
    if (hit === null || !hit.enabled) return true;
    if (view.kind === 'building') {
      const entityId = view.model.entityId;
      if (hit.action === 'upgrade') opts.onUpgrade(entityId);
      else if (hit.action === 'cancelUpgrade') opts.onCancelUpgrade(entityId);
      else if (hit.action === 'demolish') opts.onDemolish(entityId);
    } else if (view.kind === 'signpost') {
      if (hit.action === 'demolish') opts.onDemolishSignpost(view.model.entityId);
    } else if (view.kind === 'settler') {
      const entityId = view.model.entityId;
      if (hit.action === 'assign-workplace') opts.onAssignWorkplace?.(entityId);
      else if (hit.action === 'assign-home') opts.onAssignHome?.(entityId);
      else if (hit.action === 'unassign-home') opts.onUnassignHome?.(entityId);
    }
    return true;
  };

  /** Recompute + show/hide the value/name tooltip for the cursor at a client point. A cursor outside the
   *  panel hides it before any probing; inside, {@link tooltipTextAt} names what it hovers. Called on
   *  mousemove and after each panel rebuild, so a held cursor's value tracks the live model at the
   *  rebuild cadence, not per frame. */
  const updateTooltip = (clientX: number, clientY: number): void => {
    if (opts.tooltip === undefined) return;
    const { x, y } = toCanvas(clientX, clientY);
    if (view.kind === 'empty' || !contains(view.layout.panel, x, y)) {
      opts.tooltip.hide();
      return;
    }
    const text = tooltipTextAt(view, x, y, scale, activeStockTab);
    if (text === null) opts.tooltip.hide();
    else opts.tooltip.show(clientX, clientY, text);
  };

  const onMouseMove = (e: MouseEvent): void => {
    lastPointer = { clientX: e.clientX, clientY: e.clientY };
    updateTooltip(e.clientX, e.clientY);
    const { x, y } = toCanvas(e.clientX, e.clientY);
    const next = hitButton(view, x, y)?.action ?? null;
    // One hover slot serves both choice blocks — they never coexist, and `null` (the gather-all
    // button) must not fall through to the craft probe, so this is an explicit undefined-check.
    const gather = hitGatherChoice(view, x, y);
    const nextGatherGood = gather !== undefined ? gather : hitCraftChoice(view, x, y);
    if (next === hoverAction && nextGatherGood === hoveredGatherGood) return;
    hoverAction = next;
    hoveredGatherGood = nextGatherGood;
    if (view.kind !== 'empty') rebuild(view.model);
  };

  // Leaving the canvas can't fire a final over-empty mousemove, so the row tooltip would linger — hide it.
  const onMouseLeave = (): void => {
    lastPointer = null;
    opts.tooltip?.hide();
    if (hoverAction !== null || hoveredGatherGood !== undefined) {
      hoverAction = null;
      hoveredGatherGood = undefined;
      if (view.kind !== 'empty') rebuild(view.model);
    }
  };

  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseleave', onMouseLeave);

  /** The current portrait box (preview rect, bevel-inset) + its entity, for the live observation window. */
  const portrait = (): PortraitBox | null => {
    if (view.kind !== 'settler' && view.kind !== 'building') return null;
    const box = view.layout.preview;
    const inset = Math.round(PORTRAIT_BEVEL_INSET * scale);
    return {
      entityRef: view.model.entityId,
      kind: view.kind,
      rect: { x: box.x + inset, y: box.y + inset, w: box.w - 2 * inset, h: box.h - 2 * inset },
    };
  };

  /** Everything the drawn worker sprites derive from: their animation clock (`snapshot.tick` — see
   *  `worker-sprites.ts`, they advance on the sim tick, not wall-clock), the screen size (each sprite
   *  self-places in screen px), and the model + layout a rebuild replaces. */
  let lastWorkersKey = '';

  /** Redraw the animated worker sprites into the (live) Pracownicy field, or clear them when the current
   *  selection isn't a building. The field is the workers body minus the top row the limits strip occupies.
   *  Skipped while its inputs hold: it would redraw identical sprites over an O(entities) worker scan, and
   *  it is called every RAF frame. */
  const refreshWorkers = (snapshot: WorldSnapshot): void => {
    const key = `${snapshot.tick}|${app.screen.width}x${app.screen.height}|${panelEpoch}`;
    if (key === lastWorkersKey) return;
    lastWorkersKey = key;
    if (view.kind !== 'building') {
      workerOverlay.update(snapshot, null, null);
      return;
    }
    const b = view.layout.workers.body;
    // The compact limits line sits in the first row — except on a construction site, which shows no
    // strip (the field holds the live building crew instead — the overlay's siteCrew selector).
    const siteCrew = view.model.construction !== null;
    const inset = siteCrew ? 0 : Math.round(ROW_H * scale);
    const field: Rect = { x: b.x, y: b.y + inset, w: b.w, h: Math.max(0, b.h - inset) };
    // A home's field draws its residents grouped per family (the Mieszkańcy window) instead of the
    // bound-worker scan.
    const groups = view.model.home?.families.map((f) => f.members);
    workerOverlay.update(snapshot, view.model.entityId, field, {
      siteCrew,
      ...(groups !== undefined ? { groups } : {}),
    });
  };

  return {
    render(snapshot, selected): void {
      selectedIds = new Set(selected);
      updateModel(snapshot, true);
      refreshWorkers(snapshot);
    },
    tick(snapshot): void {
      updateModel(snapshot);
      refreshWorkers(snapshot);
    },
    claimsPointer,
    handleMouseDown,
    portrait,
    dispose(): void {
      canvas.removeEventListener('mousemove', onMouseMove);
      workerOverlay.dispose();
      canvas.removeEventListener('mouseleave', onMouseLeave);
      opts.tooltip?.hide();
      baked?.dispose();
      baker.dispose();
      root.destroy({ children: true });
    },
  };
}
