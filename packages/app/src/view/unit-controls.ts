import { type Camera, type EntityBounds, buildSpriteScene } from '@vinland/render';
import { type Command, type Entity, ONE, type WorldSnapshot } from '@vinland/sim';
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
 *  - **PPM** on an ENEMY unit — order the selected combatants to ATTACK it (the `attackUnit` command:
 *    they chase and strike that target); **PPM** on the ground — order them to walk there (a GROUP fans
 *    out into a formation cluster, a single unit goes exactly there — the `moveUnit` command). The
 *    move-order-onto-an-enemy = attack idiom is the original's RTS convention.
 *  - **Space** — toggle the profession-change actions panel. The info card (needs / building state) is
 *    always shown bottom-right the moment something is selected — no keypress needed.
 *  - **Esc** — clear the selection.
 *
 * Only the human player's OWN units are pickable (the targets are pre-filtered by `Owner.player`), so a
 * drag never grabs wildlife or another player's settlers. Selection is CLIENT view state (a Set of ids),
 * fed each frame to the renderer's selection rings via {@link selectedIds} — never into the sim.
 */

export interface UnitControlsOptions {
  readonly canvas: HTMLCanvasElement;
  /** Read the current camera transform (for the screen→world inverse). */
  readonly camera: () => Camera;
  /** Read the current frozen snapshot (rebuilt every frame; the controller pulls it on demand). */
  readonly snapshot: () => WorldSnapshot;
  /** Map dimensions, to clamp a move target to a legal cell. */
  readonly mapSize: { readonly width: number; readonly height: number };
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

export function createUnitControls(opts: UnitControlsOptions): UnitControls {
  const { canvas } = opts;
  const selected = new Set<number>();
  const panel: UnitPanel = mountUnitPanel({
    professions: opts.professions,
    onSetJob: (ids, jobType) => {
      for (const id of ids) opts.enqueue({ kind: 'setJob', entity: id as Entity, jobType });
    },
    onDemolish: (id) => opts.enqueue({ kind: 'demolish', building: id as Entity }),
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
  };

  const onMouseDown = (e: MouseEvent): void => {
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

  /** Right-click resolves to an ATTACK order when an enemy unit is under the cursor (the selected
   *  combatants chase + strike it), otherwise to a MOVE order at the clicked tile — the RTS idiom the
   *  original uses (move-order-onto-an-enemy = attack). */
  const issueRightClickOrder = (e: MouseEvent): void => {
    if (selected.size === 0) return;
    const w = toWorld(e.clientX, e.clientY);
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
    const target = clampTile(worldToTile(w.x, w.y), width, height);
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
      panel.toggleActions(); // the info card is always-on; Space only toggles the profession actions
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
    tick: (snapshot) => panel.tick(snapshot),
    clearSelection: () => setSelection([], false),
    dispose: () => {
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown);
      marquee.remove();
      panel.dispose();
    },
  };
}
