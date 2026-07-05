import { type Camera, type ElevationField, type EntityBounds, buildSpriteScene } from '@vinland/render';
import { type Command, type Entity, ONE, type WorldSnapshot } from '@vinland/sim';
import type { Application } from 'pixi.js';
import { backingScale } from './camera.js';
import { el } from './overlay.js';
import {
  type FormationUnit,
  type Pickable,
  assignFormation,
  clampTile,
  pickInRect,
  pickTopAt,
  screenToWorld,
  worldToTile,
} from './picking.js';
import { type SettlerActions, mountSettlerActions } from './settler-actions.js';
import { type Profession, type UnitPanel, mountUnitPanel } from './unit-panel.js';

/**
 * The interactive UNIT-CONTROL layer — the RTS "select and command" input the human drives, wired on
 * top of the pure picking math ({@link import('./picking.js')}) and the info panel
 * ({@link import('./unit-panel.js')}). It is app-layer I/O (DOM + floats), reading the mouse/keyboard
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
  /** Integer UI scale (from `?uiscale=`, shared with the tool panel) for the action ring; default 1. */
  readonly uiscale?: number;
  /** Read the current camera transform (for the screen→world inverse AND anchoring the action ring). */
  readonly camera: () => Camera;
  /** Read the current frozen snapshot (rebuilt every frame; the controller pulls it on demand). */
  readonly snapshot: () => WorldSnapshot;
  /** Map dimensions, to clamp a move target to a legal cell. */
  readonly mapSize: { readonly width: number; readonly height: number };
  /** The map's terrain-height field, so a right-click on a lifted hill resolves to the tile drawn there
   *  (elevation-aware inverse). Optional: absent / flat → the plain unlifted inverse. */
  readonly elevation?: ElevationField;
  /** The human player whose units are selectable/orderable. */
  readonly humanPlayer: number;
  /** Professions the panel offers as one-click job changes. */
  readonly professions: readonly Profession[];
  /** Submit a command into the sim (the one-way seam). */
  readonly enqueue: (command: Command) => void;
  /**
   * The renderer's EXACT per-entity sprite bounds (world px) — {@link WorldRenderer.entityBounds}. Used to
   * hit-test a click against the real graphic, so clicking anywhere on a building selects it and its box
   * scales with its size. Optional: without it (or for an off-screen target) picking uses the kind box.
   */
  readonly boundsOf?: (ref: number) => EntityBounds | undefined;
  /**
   * The HUD's pointer claim — returns true when a client point is over an on-screen HUD element (the tool
   * panel, an open window, or a placement in progress). When it does, the press is the HUD's and is NOT
   * routed to world selection / orders (the explicit HUD-before-world hit-test). Optional: no HUD → no claim.
   */
  readonly claimPointer?: (clientX: number, clientY: number) => boolean;
}

export interface UnitControls {
  /** The currently selected entity ids — fed to `renderer.update(..., selection)` for the feet rings. */
  selectedIds(): ReadonlySet<number>;
  /**
   * Per-frame hook: refresh the panel's live values (needs bars, order status). Takes the frame's
   * already-built snapshot so it does NOT rebuild a second one — `sim.snapshot()` is an O(entities)
   * allocation and is not memoised, so re-snapshotting here every frame was a real per-frame cost.
   */
  tick(snapshot: WorldSnapshot): void;
  /** Drop the selection (e.g. a scene restart mints new entity ids). */
  clearSelection(): void;
  dispose(): void;
}

/** Drag distance (client px) beyond which a press is a marquee, not a click. */
const DRAG_THRESHOLD = 5;

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
  const panel: UnitPanel = mountUnitPanel({
    professions: opts.professions,
    onDemolish: (id) => opts.enqueue({ kind: 'demolish', building: id as Entity }),
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
      const owner = e.components.Owner as { player?: unknown } | undefined;
      if (owner !== undefined && typeof owner.player === 'number') ownerOf.set(e.id, owner.player);
    }
    return ownerOf;
  };

  /** Owned, pickable targets (settlers + buildings) with their world-px feet anchors, from the snapshot. */
  const targets = (kind?: 'settler'): Pickable[] => {
    const snap = opts.snapshot();
    const ownerOf = ownersOf(snap);
    const out: Pickable[] = [];
    for (const it of buildSpriteScene(snap)) {
      if (it.kind !== 'settler' && it.kind !== 'building') continue;
      if (kind !== undefined && it.kind !== kind) continue;
      if (ownerOf.get(it.ref) !== opts.humanPlayer) continue;
      out.push({ ref: it.ref, x: it.x, y: it.y, kind: it.kind, box: opts.boundsOf?.(it.ref) });
    }
    return out;
  };

  /** ENEMY settlers — units owned by ANOTHER player (a neutral/unowned unit is not a right-click attack
   *  target; the sim re-validates hostility and drops an order at a non-hostile target). These are the
   *  hit-test set for the "right-click an enemy = attack" order. */
  const enemyTargets = (): Pickable[] => {
    const snap = opts.snapshot();
    const ownerOf = ownersOf(snap);
    const out: Pickable[] = [];
    for (const it of buildSpriteScene(snap)) {
      if (it.kind !== 'settler') continue; // only a unit is an attack target
      const owner = ownerOf.get(it.ref);
      if (owner === undefined || owner === opts.humanPlayer) continue; // neutral or own — not an enemy
      out.push({ ref: it.ref, x: it.x, y: it.y, kind: it.kind, box: opts.boundsOf?.(it.ref) });
    }
    return out;
  };

  /** Client (CSS) coords → WORLD px (through the backing-store scale + the camera inverse). */
  const toWorld = (clientX: number, clientY: number): { x: number; y: number } => {
    const { sx, sy, rect } = backingScale(canvas);
    return screenToWorld(opts.camera(), (clientX - rect.left) * sx, (clientY - rect.top) * sy);
  };

  const changed = (): void => {
    panel.render(opts.snapshot(), selected); // the info card is always-on — render reflects the new selection
  };

  const setSelection = (ids: Iterable<number>, add: boolean): void => {
    if (!add) selected.clear();
    for (const id of ids) selected.add(id);
    changed();
    // Clearing the selection closes the action ring — so re-selecting a unit doesn't silently reopen it
    // (Space is the toggle; an empty selection resets it), and Esc backs fully out of both.
    if (selected.size === 0) actions.close();
  };

  const onMouseDown = (e: MouseEvent): void => {
    // The HUD claims its own clicks BEFORE any world picking — a press over the tool panel / an open window /
    // a placement-in-progress / an open action-ring BUTTON never starts a selection or issues an order. The
    // ring claim covers the RIGHT button too (its own listener only consumes left clicks), so right-clicking
    // a ring button doesn't fall through to a world move/attack order.
    if (opts.claimPointer?.(e.clientX, e.clientY) === true) return;
    if (actions.claimsPointer(e.clientX, e.clientY)) return;
    if (e.button === 2) {
      // Right button: attack an enemy under the cursor, else move to the clicked tile.
      issueRightClickOrder(e);
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
      const hit = pickTopAt(targets(), w.x, w.y);
      if (hit !== null) setSelection([hit], e.shiftKey);
      else if (!e.shiftKey) setSelection([], false); // click on empty ground clears
    }
  };

  /** Right-click resolves to: OPEN THE ACTION MENU when one of your OWN settlers is under the cursor (select
   *  it, then show its menu — the original's "right-click a unit = its commands" idiom, alongside Space); an
   *  ATTACK order when an ENEMY unit is under the cursor (the selected combatants chase + strike it);
   *  otherwise a MOVE order at the clicked tile (move-order-onto-an-enemy = attack, the RTS idiom). */
  const issueRightClickOrder = (e: MouseEvent): void => {
    const w = toWorld(e.clientX, e.clientY);
    const own = pickTopAt(targets('settler'), w.x, w.y);
    if (own !== null) {
      setSelection([own], false); // right-click a unit selects just it …
      actions.open(); // … and brings up its action menu.
      return;
    }
    if (selected.size === 0) return;
    const enemy = pickTopAt(enemyTargets(), w.x, w.y);
    if (enemy !== null) {
      // Only the selected units that can fight (settlers) get the attack order; buildings are dropped.
      for (const t of targets('settler')) {
        if (selected.has(t.ref))
          opts.enqueue({ kind: 'attackUnit', entity: t.ref as Entity, target: enemy as Entity });
      }
      return;
    }
    issueMoveOrder(e);
  };

  const issueMoveOrder = (e: MouseEvent): void => {
    if (selected.size === 0) return;
    // The selected units that can actually move (settlers), with their world-px feet — buildings dropped.
    const movers: FormationUnit[] = targets('settler').filter((t) => selected.has(t.ref));
    if (movers.length === 0) return;
    const { width, height } = opts.mapSize;
    const w = toWorld(e.clientX, e.clientY);
    const target = clampTile(worldToTile(w.x, w.y, opts.elevation), width, height);
    // A group fans out over tiles AROUND the click (a formation cluster); a single unit goes exactly
    // there. Slots avoid tiles already held by OTHER units so the group seats onto free ground; the sim's
    // idle de-stack is the final safety net if two still coincide.
    const blocked = occupiedTiles(selected);
    for (const o of assignFormation(movers, target, width, height, blocked)) {
      opts.enqueue({ kind: 'moveUnit', entity: o.ref as Entity, x: o.tile.col, y: o.tile.row });
    }
  };

  /** A predicate marking tiles held by a settler/building NOT in `exclude` — the formation avoids them. */
  const occupiedTiles = (exclude: ReadonlySet<number>): ((col: number, row: number) => boolean) => {
    const snap = opts.snapshot();
    const occ = new Set<string>();
    for (const ent of snap.entities) {
      if (exclude.has(ent.id)) continue;
      if (ent.components.Settler === undefined && ent.components.Building === undefined) continue;
      const pos = ent.components.Position as { x: number; y: number } | undefined;
      if (pos === undefined) continue;
      occ.add(`${Math.round(pos.x / ONE)},${Math.round(pos.y / ONE)}`);
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
    tick: (snapshot) => {
      panel.tick(snapshot);
      // Re-anchor the action ring on the current selection's on-screen centroid (a no-op while it is
      // closed / nothing is selected). Reuses the frame's snapshot + the live camera — no extra scan.
      actions.update(opts.camera(), snapshot, selected);
    },
    clearSelection: () => setSelection([], false),
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
