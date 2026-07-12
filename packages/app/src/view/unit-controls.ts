import { type ContentSet, indexById } from '@vinland/data';
import {
  buildSpriteScene,
  type Camera,
  type ElevationField,
  type EntityBounds,
  type SpriteSheet,
} from '@vinland/render';
import { type Command, type Entity, nodeOfPosition, type WorldSnapshot } from '@vinland/sim';
import type { Application } from 'pixi.js';
import type { PickerEntry } from '../catalog/professions.js';
import { assignmentPriority } from '../game/sandbox/index.js';
import {
  buildingTypeOf,
  entityById,
  gathererByFlag,
  isBuilding,
  isSettler,
  ownerPlayerOf,
  positionOf,
  workFlagOf,
} from '../game/snapshot.js';
import { mountUnitPanel, type PortraitBox, type UnitPanel } from '../hud/details-panel/index.js';
import { clientToCanvas, screenScale } from './camera.js';
import { el } from './overlay.js';
import {
  assignFormation,
  clampTile,
  type FormationUnit,
  nodeBounds,
  type Pickable,
  pickInRect,
  pickTopAt,
  screenToWorld,
  worldToTile,
} from './picking.js';
import { mountSettlerActions, type SettlerActions } from './settler-actions.js';

/**
 * The interactive UNIT-CONTROL layer — the RTS "select and command" input the human drives, wired on
 * top of the pure picking math ({@link import('./picking.js')}) and the info panel
 * ({@link import('../hud/details-panel/index.js')}). It is app-layer I/O (DOM + floats), reading the mouse/keyboard
 * and issuing sim **commands** through the one-way seam; it never touches sim state directly.
 *
 * Bindings (standard RTS, chosen to not clash with the camera's middle-drag/wheel/arrows):
 *  - **LPM click** — select the unit/building under the cursor (Shift adds to the selection).
 *  - **LPM drag** — a marquee box; on release, select every owned unit whose feet fall inside it.
 *  - **PPM** on one of your OWN units — select it and bring up its ACTION MENU (the original's
 *    "right-click a unit = its commands" idiom, alongside Space); **PPM** on an ENEMY unit — order the
 *    selected combatants to ATTACK it (the `attackUnit` command: they chase and strike that target);
 *    **PPM** on the ground — order them to walk there (a GROUP fans out into a formation cluster, a single
 *    unit goes exactly there — the `moveUnit` command). The move-order-onto-an-enemy = attack idiom is the
 *    original's RTS convention.
 *  - **Space** — toggle the original-art ACTION MENU around the selected settler
 *    ({@link import('./settler-actions.js')}): the full default menu in original art, of which only "change
 *    profession" is wired today (it opens a profession picker). The info card (needs / building state) is
 *    always shown bottom-right the moment something is selected — no keypress needed.
 *  - **Esc** — clear the selection.
 *
 * Only the human player's OWN units are pickable (the targets are pre-filtered by `Owner.player`), so a
 * drag never grabs wildlife or another player's settlers. Selection is CLIENT view state (a Set of ids),
 * fed each frame to the renderer's selection rings via {@link selectedIds} — never into the sim.
 */

export interface UnitControlsOptions {
  /** The Pixi app — the action ring adds a screen-space container to its stage. */
  readonly app: Application;
  readonly canvas: HTMLCanvasElement;
  /** UI scale (from `?uiscale=`, shared with the tool panel) for the action ring; default 1. May be fractional. */
  readonly uiscale?: number;
  /** Read the current camera transform (for the screen→world inverse AND anchoring the action ring). */
  readonly camera: () => Camera;
  /** Read the current frozen snapshot (rebuilt every frame; the controller pulls it on demand). */
  readonly snapshot: () => WorldSnapshot;
  /** Map bounds in CELLS; order targeting derives the half-cell node grid via {@link nodeBounds}. */
  readonly mapSize: { readonly width: number; readonly height: number };
  /** The map's terrain-height field, so a right-click on a lifted hill resolves to the tile drawn there
   *  (elevation-aware inverse). Optional: absent / flat → the plain unlifted inverse. */
  readonly elevation?: ElevationField;
  /** The human player whose units are selectable/orderable. */
  readonly humanPlayer: number;
  /** The grouped profession-picker menu the action ring offers as one-click job changes. */
  readonly professions: readonly PickerEntry[];
  /** Global content, used by the details panel for building/goods labels and per-building sections. */
  readonly content: ContentSet;
  /** The loaded sprite sheet, forwarded to the details panel so its workers field can draw animated
   *  on-map worker sprites. Optional: absent → the field stays empty. */
  readonly sheet?: SpriteSheet;
  /** Submit a command into the sim (the one-way seam). */
  readonly enqueue: (command: Command) => void;
  /**
   * The renderer's EXACT per-entity sprite bounds (world px) — {@link WorldRenderer.entityBounds}. Used to
   * hit-test a click against the real graphic, so clicking anywhere on a building selects it and its box
   * scales with its size. Optional: without it (or for an off-screen target) picking uses the kind box.
   */
  readonly boundsOf?: (ref: number) => EntityBounds | undefined;
  /**
   * PIXEL-accurate refinement of {@link boundsOf} — {@link WorldRenderer.entityPixelHit}. Wired onto
   * BUILDING targets so a click inside the box but on transparent atlas pixels (just next to the house)
   * does NOT select; `undefined` answers keep the box verdict. Settlers stay box-picked on purpose.
   */
  readonly pixelHitOf?: (ref: number, wx: number, wy: number) => boolean | undefined;
  /**
   * The HUD's pointer claim — returns true when a client point is over an on-screen HUD element (the tool
   * panel, an open window, or a placement in progress). When it does, the press is the HUD's and is NOT
   * routed to world selection / orders (the explicit HUD-before-world hit-test). Optional: no HUD → no claim.
   */
  readonly claimPointer?: (clientX: number, clientY: number) => boolean;
  /**
   * The viewer's fog-of-war visibility at a fractional tile (a STABLE closure reading the frame's fog
   * view). Gates the ENEMY hit-test set: the sim leaves an explicit attack order fog-ungated on the
   * premise that the UI can only order onto a drawn unit — this predicate is what makes that premise
   * true (without it, right-clicking into the fog could probe for invisible enemies). Own units and
   * flags need no gate (a player always sees his own). Optional: absent = no fog, everything picks.
   */
  readonly fogVisible?: (tileX: number, tileY: number) => boolean;
  /** A cursor tooltip the details panel uses to name a hovered Magazyn stock row (passed straight through
   *  to {@link mountUnitPanel}). Absent → no stock-row tooltip. */
  readonly tooltip?: {
    show(clientX: number, clientY: number, text: string): void;
    hide(): void;
  };
}

export interface UnitControls {
  /** The currently selected entity ids — fed to `renderer.update(..., selection)` for the feet rings. */
  selectedIds(): ReadonlySet<number>;
  /** The details panel's live-portrait box (the world observation window's rect + entity), or null when the
   *  selection has no portrait. The view feeds it to `renderer.setPortraitInset` each frame. */
  portrait(): PortraitBox | null;
  /** The work-flag entity ids of the selected gatherers — fed to `renderer.update(..., flagged)` so each
   *  selected gatherer's own flag is highlighted (the amber ring). Empty when nothing selected has a flag. */
  flaggedFlagIds(): ReadonlySet<number>;
  /**
   * Per-frame hook: refresh the panel's live values (needs bars, order status). Takes the frame's
   * already-built snapshot so it does NOT rebuild a second one — `sim.snapshot()` is an O(entities)
   * allocation and is not memoised, so re-snapshotting here every frame was a real per-frame cost.
   */
  tick(snapshot: WorldSnapshot): void;
  /**
   * True when a client point is over the HUD this controller defers to before world picking — the
   * tool-panel/window claim it was handed PLUS its own settler action ring (drawn on the canvas, so a
   * `target === canvas` test alone misses it). Another input consumer (the admin spawn palette) asks
   * this so its map clicks defer to the SAME chrome this controller does, not a partial copy of it.
   */
  claimsPointer(clientX: number, clientY: number): boolean;
  dispose(): void;
}

/** Drag distance (client px) beyond which a press is a marquee, not a click. */
const DRAG_THRESHOLD = 5;

/** Shared empty id set (no per-call allocation when nothing is selected). */
const EMPTY_IDS: ReadonlySet<number> = new Set();

/** Equal membership of two id sets — tells whether a re-selection actually changed the selection. */
const sameSelection = (a: ReadonlySet<number>, b: ReadonlySet<number>): boolean => {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
};

const MARQUEE_STYLE = [
  'position:fixed',
  'border:1px solid #66ff66',
  'background:rgba(102,255,102,0.12)',
  'pointer-events:none',
  'z-index:55',
  'display:none',
].join(';');

export async function createUnitControls(opts: UnitControlsOptions): Promise<UnitControls> {
  const { canvas } = opts;
  const selected = new Set<number>();
  // Building types keyed by typeId — the source of a building's worker slots, used to build the
  // right-click assignment priority (craftsmen first, carrier fallback, gatherers never).
  const buildingsByType = indexById(opts.content.buildings);
  // Late-bound: the panel's "clicked a worker sprite" callback needs `setSelection`, which is defined
  // below (it closes over `panel`). Assigned once everything exists; a click can only fire afterwards.
  let selectFromPanel: (id: number) => void = () => {};
  const panel: UnitPanel = await mountUnitPanel({
    app: opts.app,
    canvas,
    uiscale: opts.uiscale ?? 1,
    // Adapt main's `screenScale(canvas, resolution)` to the panel's `backingScale(canvas)` option by
    // binding the renderer resolution (camera dropped the old zero-arg `backingScale`).
    backingScale: (c: HTMLCanvasElement) => screenScale(c, opts.app.renderer.resolution),
    buildings: opts.content.buildings,
    goods: opts.content.goods,
    jobs: opts.content.jobs,
    ...(opts.sheet !== undefined ? { sheet: opts.sheet } : {}),
    onDemolish: (id) => opts.enqueue({ kind: 'demolish', building: id as Entity }),
    onSelectEntity: (id) => selectFromPanel(id),
    ...(opts.tooltip !== undefined ? { tooltip: opts.tooltip } : {}),
  });
  // The contextual ACTION MENU (full original-art default menu; only "change profession" is wired on this
  // slice — it opens the profession picker), anchored on the selected settler. Mounted BEFORE this
  // controller's own canvas listeners so a click on a menu button consumes the press (stopImmediatePropagation)
  // and never falls through to selection / a move order.
  const actions: SettlerActions = await mountSettlerActions({
    app: opts.app,
    canvas,
    uiscale: opts.uiscale ?? 1,
    professions: opts.professions,
    onSetJob: (ids, jobType) => {
      for (const id of ids) opts.enqueue({ kind: 'setJob', entity: id as Entity, jobType });
    },
  });

  const marquee = el('div', MARQUEE_STYLE);
  document.body.append(marquee);

  let dragging = false;
  let startX = 0;
  let startY = 0;

  /** Map each entity id → the player that owns it (absent for a neutral/unowned entity), from a snapshot. */
  const ownersOf = (snap: WorldSnapshot): Map<number, number> => {
    const ownerOf = new Map<number, number>();
    for (const e of snap.entities) {
      const player = ownerPlayerOf(e);
      if (player !== undefined) ownerOf.set(e.id, player);
    }
    return ownerOf;
  };

  /** Owned, pickable targets (settlers + buildings) with their world-px feet anchors, from the snapshot. */
  const targets = (kind?: 'settler' | 'building'): Pickable[] => {
    const snap = opts.snapshot();
    const ownerOf = ownersOf(snap);
    const out: Pickable[] = [];
    for (const it of buildSpriteScene(snap)) {
      if (it.kind !== 'settler' && it.kind !== 'building') continue;
      if (kind !== undefined && it.kind !== kind) continue;
      if (ownerOf.get(it.ref) !== opts.humanPlayer) continue;
      const pixelHitOf = opts.pixelHitOf;
      out.push({
        ref: it.ref,
        x: it.x,
        y: it.y,
        kind: it.kind,
        box: opts.boundsOf?.(it.ref),
        // Buildings refine to solid pixels (see UnitControlsOptions.pixelHitOf); settlers keep the box.
        ...(it.kind === 'building' && pixelHitOf !== undefined
          ? { pixelHit: (wx: number, wy: number) => pixelHitOf(it.ref, wx, wy) }
          : {}),
      });
    }
    return out;
  };

  /** ENEMY settlers — units owned by ANOTHER player (a neutral/unowned unit is not a right-click attack
   *  target; the sim re-validates hostility and drops an order at a non-hostile target). These are the
   *  hit-test set for the "right-click an enemy = attack" order. Fog-culled like the drawn scene
   *  ({@link UnitControlsOptions.fogVisible}): an invisible enemy must not be orderable-onto. */
  const enemyTargets = (): Pickable[] => {
    const snap = opts.snapshot();
    const ownerOf = ownersOf(snap);
    const out: Pickable[] = [];
    for (const it of buildSpriteScene(snap, { fogVisible: opts.fogVisible })) {
      if (it.kind !== 'settler') continue; // only a unit is an attack target
      const owner = ownerOf.get(it.ref);
      if (owner === undefined || owner === opts.humanPlayer) continue; // neutral or own — not an enemy
      out.push({ ref: it.ref, x: it.x, y: it.y, kind: it.kind, box: opts.boundsOf?.(it.ref) });
    }
    return out;
  };

  /** Pickables for the human's gatherers' drop-off FLAGS, each mapped to its OWNING gatherer so a
   *  left-click on a flag SELECTS that gatherer — the flag→unit inverse of {@link flaggedFlagIds}'s
   *  unit→flag highlight (a flag stores no owner id, so `gathererByFlag` recovers the edge). Only the
   *  human's flags; a flag whose owner isn't the human is skipped. The click handler consults this AFTER
   *  settlers/buildings miss, so a gatherer standing on its own flag still selects AS a unit. */
  const flagTargets = (): Pickable[] => {
    const snap = opts.snapshot();
    const gathererOf = gathererByFlag(snap, opts.humanPlayer); // flag-id → owning gatherer-id (not a player id)
    if (gathererOf.size === 0) return [];
    const out: Pickable[] = [];
    for (const it of buildSpriteScene(snap)) {
      if (it.isFlag !== true) continue;
      const gatherer = gathererOf.get(it.ref);
      if (gatherer === undefined) continue; // an unbound / non-human flag — not a selection proxy
      out.push({ ref: gatherer, x: it.x, y: it.y, kind: 'settler' });
    }
    return out;
  };

  /** Client (CSS) coords → WORLD px (through the client→screen scale + the camera inverse). */
  const toWorld = (clientX: number, clientY: number): { x: number; y: number } => {
    const c = clientToCanvas(screenScale(canvas, opts.app.renderer.resolution), clientX, clientY);
    return screenToWorld(opts.camera(), c.x, c.y);
  };

  const changed = (): void => {
    panel.render(opts.snapshot(), selected); // the info card is always-on — render reflects the new selection
  };

  const setSelection = (ids: Iterable<number>, add: boolean): void => {
    const before = new Set(selected); // snapshot to detect whether the selection actually changed
    if (!add) selected.clear();
    for (const id of ids) selected.add(id);
    changed();
    // A CHANGED selection closes the action ring: picking a different unit (or clearing to empty) backs out
    // of an open menu, so the ring never lingers on a stale unit and Space stays the sole re-open. Re-selecting
    // the exact same set leaves it alone; right-click's "select-then-open" re-opens the ring on the new unit
    // in the very next call, so that path is unaffected.
    if (!sameSelection(before, selected)) actions.close();
  };

  // Clicking a worker sprite in the details panel selects just that settler (dropping the building) —
  // the same result as clicking it on the map, so the panel flips to the settler's info card.
  selectFromPanel = (id) => setSelection([id], false);

  const onMouseDown = (e: MouseEvent): void => {
    // The HUD claims its own clicks BEFORE any world picking — a press over the tool panel / an open window /
    // a placement-in-progress / an open action-ring BUTTON never starts a selection or issues an order. The
    // ring claim covers the RIGHT button too (its own listener only consumes left clicks), so right-clicking
    // a ring button doesn't fall through to a world move/attack order.
    if (opts.claimPointer?.(e.clientX, e.clientY) === true) return;
    // The details panel routes its own button clicks through the same claim (one mechanism, no
    // panel-owned mousedown listener racing this one).
    if (panel.handleMouseDown(e.clientX, e.clientY, e.button)) return;
    if (actions.claimsPointer(e.clientX, e.clientY)) return;
    if (e.button === 2) {
      // Ctrl+Right (⌘ on macOS): plant/move the selected gatherer(s)' work flag on the clicked tile —
      // "work here". Plain Right: attack an enemy under the cursor, else move to the clicked tile.
      if (e.ctrlKey || e.metaKey) issueSetWorkFlag(e);
      else issueRightClickOrder(e);
      return;
    }
    if (e.button !== 0) return; // middle = camera pan (handled by the camera controller)
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
  };

  const onMouseMove = (e: MouseEvent): void => {
    if (!dragging) return;
    const dx = Math.abs(e.clientX - startX);
    const dy = Math.abs(e.clientY - startY);
    if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return; // still a click, no box yet
    marquee.style.display = 'block';
    marquee.style.left = `${Math.min(startX, e.clientX)}px`;
    marquee.style.top = `${Math.min(startY, e.clientY)}px`;
    marquee.style.width = `${dx}px`;
    marquee.style.height = `${dy}px`;
  };

  const onMouseUp = (e: MouseEvent): void => {
    if (e.button !== 0 || !dragging) return;
    dragging = false;
    marquee.style.display = 'none';
    const moved =
      Math.abs(e.clientX - startX) >= DRAG_THRESHOLD || Math.abs(e.clientY - startY) >= DRAG_THRESHOLD;
    if (moved) {
      const a = toWorld(startX, startY);
      const b = toWorld(e.clientX, e.clientY);
      setSelection(pickInRect(targets(), a.x, a.y, b.x, b.y), e.shiftKey);
    } else {
      const w = toWorld(e.clientX, e.clientY);
      // A settler/building under the cursor wins; failing that, a gatherer's FLAG selects its gatherer.
      const hit = pickTopAt(targets(), w.x, w.y) ?? pickTopAt(flagTargets(), w.x, w.y);
      if (hit !== null) setSelection([hit], e.shiftKey);
      else if (!e.shiftKey) setSelection([], false); // click on empty ground clears
    }
  };

  /** Right-click resolves to: OPEN THE ACTION MENU when one of your OWN settlers is under the cursor (select
   *  it, then show its menu — the original's "right-click a unit = its commands" idiom, alongside Space); an
   *  ATTACK order when an ENEMY unit is under the cursor (the selected combatants chase + strike it); an
   *  ASSIGN-WORKER order when one of your OWN BUILDINGS is under the cursor and settlers are selected (employ
   *  them there — the badge appears by its door); otherwise a MOVE order at the clicked tile
   *  (move-order-onto-an-enemy = attack, the RTS idiom). */
  const issueRightClickOrder = (e: MouseEvent): void => {
    const w = toWorld(e.clientX, e.clientY);
    // One O(entities) scan per click, shared by all branches (each `targets` call rebuilds the scene).
    const ownSettlers = targets('settler');
    const own = pickTopAt(ownSettlers, w.x, w.y);
    if (own !== null) {
      setSelection([own], false); // right-click a unit selects just it …
      actions.open(); // … and brings up its action menu.
      return;
    }
    if (selected.size === 0) return;
    const enemy = pickTopAt(enemyTargets(), w.x, w.y);
    if (enemy !== null) {
      // Only the selected units that can fight (settlers) get the attack order; buildings are dropped.
      for (const t of ownSettlers) {
        if (selected.has(t.ref))
          opts.enqueue({ kind: 'attackUnit', entity: t.ref as Entity, target: enemy as Entity });
      }
      return;
    }
    // Right-click on one of your OWN buildings with settlers selected = employ them there. The assignment
    // PRIORITY (craftsman first, carrier as the fallback, gatherer never) is built from the building's
    // worker slots and handed to the sim, which binds each settler to the first open, qualified job in
    // that order (a full/wrong-tribe/home building resolves to nothing → a no-op). Only the SELECTED
    // settlers are assigned; a selected building can't be a worker and is dropped.
    const building = pickTopAt(targets('building'), w.x, w.y);
    if (building !== null) {
      const ent = entityById(opts.snapshot(), building);
      const type = ent !== undefined ? buildingTypeOf(ent) : undefined;
      const jobPriority = assignmentPriority(
        type !== undefined ? buildingsByType.get(type)?.workers : undefined,
      );
      if (jobPriority.length > 0) {
        for (const t of ownSettlers) {
          if (selected.has(t.ref))
            opts.enqueue({
              kind: 'assignWorker',
              entity: t.ref as Entity,
              building: building as Entity,
              jobPriority,
            });
        }
      }
      return; // right-clicking your own building never falls through to a move order
    }
    issueMoveOrder(e, ownSettlers);
  };

  const issueMoveOrder = (e: MouseEvent, ownSettlers: readonly Pickable[]): void => {
    if (selected.size === 0) return;
    // The selected units that can actually move (settlers), with their world-px feet — buildings dropped.
    const movers: FormationUnit[] = ownSettlers.filter((t) => selected.has(t.ref));
    if (movers.length === 0) return;
    // Orders live on the half-cell node lattice.
    const { width, height } = nodeBounds(opts.mapSize);
    const w = toWorld(e.clientX, e.clientY);
    const target = clampTile(worldToTile(w.x, w.y, opts.elevation), width, height);
    // A group fans out over nodes AROUND the click (a formation cluster); a single unit goes exactly
    // there. Slots avoid nodes already held by OTHER units so the group seats onto free ground; the sim's
    // idle de-stack is the final safety net if two still coincide.
    const blocked = occupiedTiles(selected);
    for (const o of assignFormation(movers, target, width, height, blocked)) {
      opts.enqueue({ kind: 'moveUnit', entity: o.ref as Entity, x: o.tile.col, y: o.tile.row });
    }
  };

  /** Ctrl+Right-Click: plant / move the selected gatherer(s)' work flag onto the clicked node. Issued for
   *  every selected own settler; the sim skips any whose job cannot harvest (a soldier gets no flag). */
  const issueSetWorkFlag = (e: MouseEvent): void => {
    if (selected.size === 0) return;
    const movers = targets('settler').filter((t) => selected.has(t.ref));
    if (movers.length === 0) return;
    const { width, height } = nodeBounds(opts.mapSize);
    const w = toWorld(e.clientX, e.clientY);
    const target = clampTile(worldToTile(w.x, w.y, opts.elevation), width, height);
    for (const m of movers) {
      opts.enqueue({ kind: 'setWorkFlag', entity: m.ref as Entity, x: target.col, y: target.row });
    }
  };

  /** The flag entity ids of the currently-selected gatherers (their {@link WorkFlag}.flag), so the renderer
   *  can highlight each selected gatherer's own flag. A per-frame scan gated on a non-empty selection. */
  const flaggedFlagIds = (): ReadonlySet<number> => {
    if (selected.size === 0) return EMPTY_IDS;
    const out = new Set<number>();
    for (const ent of opts.snapshot().entities) {
      if (!selected.has(ent.id)) continue;
      const flag = workFlagOf(ent);
      if (flag !== undefined) out.add(flag);
    }
    return out;
  };

  /** A predicate marking NODES held by a settler/building NOT in `exclude` — the formation avoids them. */
  const occupiedTiles = (exclude: ReadonlySet<number>): ((col: number, row: number) => boolean) => {
    const snap = opts.snapshot();
    const occ = new Set<string>();
    for (const ent of snap.entities) {
      if (exclude.has(ent.id)) continue;
      if (!isSettler(ent) && !isBuilding(ent)) continue;
      const pos = positionOf(ent);
      if (pos === undefined) continue;
      const n = nodeOfPosition(pos.x, pos.y);
      occ.add(`${n.hx},${n.hy}`);
    }
    return (col, row) => occ.has(`${col},${row}`);
  };

  const onContextMenu = (e: MouseEvent): void => {
    e.preventDefault(); // let the right button be a move order, not the browser menu
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Space') {
      e.preventDefault(); // Space would otherwise scroll the page
      actions.toggle(); // the info card is always-on; Space only toggles the action ring
    } else if (e.code === 'Escape') {
      setSelection([], false);
    }
  };

  canvas.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('keydown', onKeyDown);

  return {
    selectedIds: () => selected,
    portrait: () => panel.portrait(),
    flaggedFlagIds,
    // The HUD this controller defers to before world picking: the tool panel/windows (handed in), the
    // bottom-right details panel, and its own settler action ring. Including the details panel means a
    // consumer that gates on this — the admin spawn palette, the world hover tooltip — treats a point over
    // the panel as HUD, not world (so a spawn click / a pile tooltip never fires under the open panel).
    claimsPointer: (x, y) =>
      opts.claimPointer?.(x, y) === true || panel.claimsPointer(x, y) || actions.claimsPointer(x, y),
    tick: (snapshot) => {
      panel.tick(snapshot);
      // Re-anchor the action ring on the current selection's on-screen centroid (a no-op while it is
      // closed / nothing is selected). Reuses the frame's snapshot + the live camera — no extra scan.
      actions.update(opts.camera(), snapshot, selected);
    },
    dispose: () => {
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown);
      marquee.remove();
      panel.dispose();
      actions.dispose();
    },
  };
}
