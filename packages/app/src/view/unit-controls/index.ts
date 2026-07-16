import { indexById } from '@open-northland/data';
import type { BuildingHighlightItem } from '@open-northland/render';
import type { Entity } from '@open-northland/sim';
import { workFlagOf } from '../../game/snapshot.js';
import { mountUnitPanel, type UnitPanel } from '../../hud/details-panel/index.js';
import { clientToScreen, screenScale } from '../camera.js';
import { clampTile, nodeBounds, pickInRect, pickTopAt, screenToWorld, worldToTile } from '../picking.js';
import { assignableJobForBuilding, computeAssignHighlight } from './assign-highlight.js';
import { computeHouseHighlight, houseAssignableAt } from './house-highlight.js';
import { createSelectionMarquee } from './marquee.js';
import { createUnitOrderController } from './orders.js';
import { mountSettlerActions, type SettlerActions } from './settler-actions.js';
import type { UnitControls, UnitControlsOptions } from './types.js';
import { createUnitTargets } from './unit-targets.js';

export type { UnitControls, UnitControlsOptions } from './types.js';

/**
 * The interactive unit-control layer — the RTS "select and command" input the human drives, wired on
 * top of the pure picking math ({@link import('../picking.js')}) and the info panel
 * ({@link import('../../hud/details-panel/index.js')}). It is app-layer I/O (DOM + floats), reading the mouse/keyboard
 * and issuing sim **commands** through the one-way seam; it never touches sim state directly.
 *
 * Bindings (standard RTS, chosen to not clash with the camera's middle-drag/wheel/arrows):
 *  - **LPM click** — select the unit/building under the cursor (Shift adds to the selection).
 *  - **LPM drag** — a marquee box; on release, select every owned unit whose feet fall inside it.
 *  - **PPM** on one of your own units — select it and bring up its action menu (the original's
 *    "right-click a unit = its commands" idiom, alongside Space); **PPM** on an enemy unit — order the
 *    selected combatants to attack it (the `attackUnit` command: they chase and strike that target);
 *    **PPM** on the ground — order them to walk there (a group fans out into a formation cluster, a single
 *    unit goes exactly there — the `moveUnit` command). The move-order-onto-an-enemy = attack idiom is the
 *    original's RTS convention.
 *  - **Space** — toggle the original-art action menu around the selected settler
 *    ({@link import('./settler-actions.js')}): the full default menu in original art, of which only "change
 *    profession" is wired today (it opens a profession picker). The info card (needs / building state) is
 *    always shown bottom-right the moment something is selected — no keypress needed.
 *  - **Esc** — clear the selection.
 *
 * Only the human player's own units are pickable (the targets are pre-filtered by `Owner.player`), so a
 * drag never grabs wildlife or another player's settlers. Selection is client view state (a Set of ids),
 * fed each frame to the renderer's selection rings via {@link selectedIds} — never into the sim.
 */

/** Shared empty id set (no per-call allocation when nothing is selected). */
const EMPTY_IDS: ReadonlySet<number> = new Set();

/** Equal membership of two id sets — tells whether a re-selection actually changed the selection. */
const sameSelection = (a: ReadonlySet<number>, b: ReadonlySet<number>): boolean => {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
};

export async function createUnitControls(opts: UnitControlsOptions): Promise<UnitControls> {
  const { canvas } = opts;
  const selected = new Set<number>();
  const buildingsByType = indexById(opts.content.buildings);
  // "Przydziel miejsce pracy" mode: the settler whose workplace the player is choosing (null = not in the
  // mode). While set, candidate buildings are washed green/red and the next left-click on a green one binds
  // the settler; a click on a red building / terrain, right-click, Esc, or a selection change cancels.
  let assignSettler: number | null = null;
  // "Przypisz dom" mode: the settler whose home the player is choosing (null = not in the mode) — the
  // residential twin of assign mode: homes wash green/red and the next left-click on a green home
  // assigns the settler's family there; the same gestures cancel.
  let houseSettler: number | null = null;
  const cancelAssign = (): void => {
    assignSettler = null;
    houseSettler = null;
  };
  // "Erect Signpost" mode: the scout(s) the placement click applies to (null = not in the mode). While
  // set, the next left-click on the world orders the first scout to erect a signpost on the clicked node
  // (the original's "Select place for signpost" flow); right-click, Esc, or a selection change cancels.
  let signpostScouts: readonly number[] | null = null;
  const cancelSignpost = (): void => {
    signpostScouts = null;
  };
  // Late-bound: the panel's "clicked a worker sprite" callback needs `setSelection`, which is defined
  // below (it closes over `panel`). Assigned once everything exists; a click can only fire afterwards.
  let selectFromPanel: (id: number) => void = () => {};
  const panel: UnitPanel = await mountUnitPanel({
    app: opts.app,
    canvas,
    uiscale: opts.uiscale ?? 1,
    lang: opts.lang,
    // Adapt main's `screenScale(canvas, resolution)` to the panel's `backingScale(canvas)` option by
    // binding the renderer resolution.
    backingScale: (c: HTMLCanvasElement) => screenScale(c, opts.app.renderer.resolution),
    buildings: opts.content.buildings,
    goods: opts.content.goods,
    jobs: opts.content.jobs,
    ...(opts.sheet !== undefined ? { sheet: opts.sheet } : {}),
    onDemolish: (id) => opts.enqueue({ kind: 'demolish', building: id as Entity }),
    onDemolishSignpost: (id) => opts.enqueue({ kind: 'demolishSignpost', signpost: id as Entity }),
    onAssignWorkplace: (id) => {
      assignSettler = id;
      houseSettler = null; // the two pick modes are exclusive — arming one disarms the other
    },
    onAssignHome: (id) => {
      houseSettler = id;
      assignSettler = null;
    },
    onSetGatherGood: (id, goodType) =>
      opts.enqueue({ kind: 'setGatherGood', entity: id as Entity, goodType }),
    onSetCraftGoods: (id, goods) =>
      opts.enqueue({ kind: 'setCraftGoods', entity: id as Entity, goods: [...goods] }),
    onSelectEntity: (id) => selectFromPanel(id),
    ...(opts.tooltip !== undefined ? { tooltip: opts.tooltip } : {}),
  });
  // The contextual action menu, anchored on the selected settler. Mounted before this controller's own
  // canvas listeners so a click on a menu button consumes the press (stopImmediatePropagation) and never
  // falls through to selection / a move order.
  const actions: SettlerActions = await mountSettlerActions({
    app: opts.app,
    canvas,
    uiscale: opts.uiscale ?? 1,
    professions: opts.professions,
    onSetJob: (ids, jobType) => {
      for (const id of ids) opts.enqueue({ kind: 'setJob', entity: id as Entity, jobType });
    },
    onErectSignpost: (ids) => {
      signpostScouts = ids;
    },
    onMarry: (id) => opts.enqueue({ kind: 'marry', entity: id as Entity }),
    onAssignHouse: (id) => {
      houseSettler = id;
      assignSettler = null; // exclusive with the workplace pick mode
      signpostScouts = null; // …and with signpost placement
    },
    onMakeChild: (id, sex) => opts.enqueue({ kind: 'makeChild', entity: id as Entity, child: sex }),
  });

  const marquee = createSelectionMarquee();

  // The snapshot-derived pickable target sets a click hit-tests against — owned units/buildings, enemy
  // units, and the gatherers' work-flag proxies. See unit-targets.ts (they read only the snapshot +
  // the injected render hit-test helpers, so they live apart from the selection/order logic here).
  const unitTargets = createUnitTargets({
    snapshot: opts.snapshot,
    humanPlayer: opts.humanPlayer,
    boundsOf: opts.boundsOf,
    pixelHitOf: opts.pixelHitOf,
    fogVisible: opts.fogVisible,
  });

  /** Client (CSS) coords → world px (through the client→screen scale + the camera inverse). */
  const toWorld = (clientX: number, clientY: number): { x: number; y: number } => {
    const c = clientToScreen(canvas, opts.app.renderer.resolution, clientX, clientY);
    return screenToWorld(opts.camera(), c.x, c.y);
  };

  const changed = (): void => {
    panel.render(opts.snapshot(), selected); // the info card is always-on — render reflects the new selection
  };

  const setSelection = (ids: Iterable<number>, add: boolean): void => {
    const before = new Set(selected); // snapshot to detect whether the selection actually changed
    if (!add) selected.clear();
    for (const id of ids) selected.add(id);
    if (!sameSelection(before, selected)) {
      cancelAssign(); // a new selection backs out of assign mode
      cancelSignpost(); // …and out of the signpost-placement mode
    }
    changed();
    // A changed selection closes the action ring: picking a different unit (or clearing to empty) backs out
    // of an open menu, so the ring never lingers on a stale unit and Space stays the sole re-open. Re-selecting
    // the exact same set leaves it alone; right-click's "select-then-open" re-opens the ring on the new unit
    // in the very next call, so that path is unaffected.
    if (!sameSelection(before, selected)) actions.close();
  };

  // Clicking a worker sprite in the details panel selects just that settler (dropping the building) —
  // the same result as clicking it on the map, so the panel flips to the settler's info card.
  selectFromPanel = (id) => setSelection([id], false);

  const orders = createUnitOrderController({
    selected,
    targets: unitTargets,
    snapshot: opts.snapshot,
    content: opts.content,
    mapSize: opts.mapSize,
    ...(opts.elevation !== undefined ? { elevation: opts.elevation } : {}),
    toWorld,
    enqueue: opts.enqueue,
    selectOwnSettler: (id) => setSelection([id], false),
    openActions: () => actions.open(),
  });

  /** Resolve a world click while in "przydziel miejsce pracy" mode: bind the settler to the building under
   *  the cursor when it offers an open slot (a green building), else cancel. Any resolving click exits the
   *  mode (the chosen UX: assign-and-leave; a red building / terrain click just leaves). */
  const resolveAssign = (e: MouseEvent): void => {
    const settlerId = assignSettler;
    cancelAssign();
    if (settlerId === null) return;
    const w = toWorld(e.clientX, e.clientY);
    const building = pickTopAt(unitTargets.owned('building'), w.x, w.y);
    if (building === null) return; // clicked terrain / a unit — cancel
    const snapshot = opts.snapshot();
    // The button places the settler's CURRENT trade only (it never re-trades): bind exactly the building's
    // matching slot, or cancel when the building doesn't offer it (a red building).
    const job = assignableJobForBuilding(snapshot, building, settlerId, buildingsByType);
    if (job === null) return; // red — cancel
    opts.enqueue({
      kind: 'assignWorker',
      entity: settlerId as Entity,
      building: building as Entity,
      jobPriority: [job],
    });
  };

  /** Resolve a world click in "przypisz dom" mode: assign the family to the home under the cursor when
   *  it fits (a green home), else cancel. Any resolving click exits the mode (assign-and-leave). */
  const resolveHouseAssign = (e: MouseEvent): void => {
    const settlerId = houseSettler;
    cancelAssign();
    if (settlerId === null) return;
    const w = toWorld(e.clientX, e.clientY);
    const building = pickTopAt(unitTargets.owned('building'), w.x, w.y);
    if (building === null) return; // clicked terrain / a unit — cancel
    if (!houseAssignableAt(opts.snapshot(), building, settlerId, buildingsByType)) return; // red — cancel
    opts.enqueue({ kind: 'assignHouse', entity: settlerId as Entity, house: building as Entity });
  };

  /** The green/red building wash for the render layer — the workplace-assign candidates, the home-assign
   *  candidates, or null when neither pick mode is active. Recomputed per frame from the live snapshot
   *  (an O(entity count) pass) so a slot/house filling elsewhere re-colours immediately; only runs while
   *  a pick mode is active, a transient gesture. */
  const assignHighlight = (): readonly BuildingHighlightItem[] | null => {
    if (assignSettler !== null)
      return computeAssignHighlight(opts.snapshot(), assignSettler, buildingsByType);
    if (houseSettler !== null) return computeHouseHighlight(opts.snapshot(), houseSettler, buildingsByType);
    return null;
  };

  const onMouseDown = (e: MouseEvent): void => {
    // The HUD claims its own clicks before any world picking — a press over the tool panel / an open window /
    // a placement-in-progress / an open action-ring button never starts a selection or issues an order. The
    // ring claim covers the right button too (its own listener only consumes left clicks), so right-clicking
    // a ring button doesn't fall through to a world move/attack order.
    if (opts.claimPointer?.(e.clientX, e.clientY) === true) return;
    // The details panel routes its own button clicks through the same claim (one mechanism, no
    // panel-owned mousedown listener racing this one).
    if (panel.handleMouseDown(e.clientX, e.clientY, e.button, e.ctrlKey || e.metaKey)) return;
    if (actions.claimsPointer(e.clientX, e.clientY)) return;
    // In "przydziel miejsce pracy" mode a world click resolves the assignment (left = bind a green building,
    // else cancel; right = cancel) and consumes the press — it never falls through to selection / an order.
    if (assignSettler !== null) {
      if (e.button === 0) resolveAssign(e);
      else cancelAssign();
      return;
    }
    // In "Erect Signpost" mode a left world click orders the scout to erect on the clicked node and
    // consumes the press; any other button cancels the mode. Legality is the sim command's gate (an
    // illegal spot is a logged no-op), so a bad click simply leaves the scout unmoved.
    // Named deviation (observed original, tutorial_001 briefing): the original erects with RIGHT-click
    // on ground that is "lit up"; we place with LEFT-click and dim blocked ground instead — the same
    // convention as our build placement, so the two placement modes read identically.
    if (signpostScouts !== null) {
      const scout = signpostScouts[0];
      cancelSignpost();
      if (e.button === 0 && scout !== undefined) {
        const { width, height } = nodeBounds(opts.mapSize);
        const w = toWorld(e.clientX, e.clientY);
        const target = clampTile(worldToTile(w.x, w.y, opts.elevation), width, height);
        opts.enqueue({ kind: 'placeSignpost', entity: scout as Entity, x: target.col, y: target.row });
      }
      return;
    }
    if (houseSettler !== null) {
      if (e.button === 0) resolveHouseAssign(e);
      else cancelAssign();
      return;
    }
    if (e.button === 2) {
      // Ctrl+Right (⌘ on macOS): plant/move the selected gatherer(s)' work flag on the clicked tile —
      // "work here". Plain Right: attack an enemy under the cursor, else move to the clicked tile.
      if (e.ctrlKey || e.metaKey) orders.issueSetWorkFlag(e);
      else orders.issueRightClick(e);
      return;
    }
    if (e.button !== 0) return; // middle = camera pan (handled by the camera controller)
    marquee.begin(e.clientX, e.clientY);
  };

  const onMouseMove = (e: MouseEvent): void => {
    marquee.update(e.clientX, e.clientY);
  };

  const onMouseUp = (e: MouseEvent): void => {
    if (e.button !== 0 || !marquee.active()) return;
    const release = marquee.release(e.clientX, e.clientY);
    if (release === null) return;
    if (release.moved) {
      const a = toWorld(release.startX, release.startY);
      const b = toWorld(e.clientX, e.clientY);
      setSelection(pickInRect(unitTargets.owned(), a.x, a.y, b.x, b.y), e.shiftKey);
    } else {
      const w = toWorld(e.clientX, e.clientY);
      // A settler/building under the cursor wins; failing that, a gatherer's flag selects its gatherer,
      // then an own signpost (direct click only — the marquee never grabs a post).
      const hit =
        pickTopAt(unitTargets.owned(), w.x, w.y) ??
        pickTopAt(unitTargets.flags(), w.x, w.y) ??
        pickTopAt(unitTargets.signposts(), w.x, w.y);
      if (hit !== null) setSelection([hit], e.shiftKey);
      else if (!e.shiftKey) setSelection([], false); // click on empty ground clears
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

  const onContextMenu = (e: MouseEvent): void => {
    e.preventDefault(); // let the right button be a move order, not the browser menu
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Space') {
      e.preventDefault(); // Space would otherwise scroll the page
      actions.toggle(); // the info card is always-on; Space only toggles the action ring
    } else if (e.code === 'Escape') {
      if (assignSettler !== null || houseSettler !== null) {
        cancelAssign(); // Esc first backs out of a pick mode, keeping the selection
      } else if (signpostScouts !== null) {
        cancelSignpost(); // …or out of signpost placement, likewise keeping the selection
      } else {
        setSelection([], false);
      }
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
    assignHighlight,
    signpostPlacementActive: () => signpostScouts !== null,
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
      marquee.dispose();
      panel.dispose();
      actions.dispose();
    },
  };
}
