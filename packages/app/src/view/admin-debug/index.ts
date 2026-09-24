import type { Command, Entity, FogMode } from '@open-northland/sim';
import { HUMAN_HITPOINTS } from '../../catalog/units.js';
import { HUMAN_PLAYER } from '../../game/rules.js';
import { resourceCommand } from '../../game/sandbox/place/index.js';
import { formatMessage, messages } from '../../i18n/index.js';
import { BUTTON_STYLE, el } from '../overlay.js';
import { DEBUG_ACTIONS, type DebugAction, type DebugTargetKind } from './actions-catalog.js';
import {
  ADMIN_PANEL_STYLE,
  BODY_STYLE,
  collapsibleSection,
  FOOTER_STYLE,
  filterInput,
  HEADER_STYLE,
  type LabelledButton,
  numberField,
  PANEL_BELOW_CHIP_PX,
  ROW_STYLE,
  rowOf,
  SECTION_TITLE_STYLE,
  selectField,
  setButtonActive,
  TOGGLE_STYLE,
} from './chrome.js';
import { type Armed, createAdminLabels, sameArmed } from './labels.js';
import {
  createFogSwitcher,
  createGeometryToggle,
  createNeedsToggle,
  createZoomOutToggle,
} from './live-toggles.js';
import {
  type AnimalEntry,
  ARMOR_CLASSES,
  animalSpawnCommand,
  CIVILIAN_PRESETS,
  type GoodEntry,
  goodDropCommand,
  PLAYER_SWATCHES,
  RESOURCE_ENTRIES,
  unitSpawnCommand,
  type VehicleEntry,
  vehicleSpawnCommand,
  WARRIOR_PRESETS,
} from './spawn-catalog.js';

/**
 * The admin and debug spawn palette: arm a tool, then click the map to drop a test entity or run an
 * entity action on what is already there. Every poke goes through the sim command seam, so it stays as
 * replay-faithful as a player order. The session owns its listeners and DOM lifetime: a world torn
 * down in place disposes it before the next one mounts its own.
 */

export interface AdminDebugDeps {
  readonly canvas: HTMLCanvasElement;
  readonly enqueue: (command: Command) => void;
  /** Map a client point to a map tile, null off the map. */
  readonly clientToTile: (clientX: number, clientY: number) => { col: number; row: number } | null;
  /** Pick the top entity of `kind` under a client point, any owner unlike the RTS selection. Absent
   *  leaves the action tools inert. */
  readonly pickEntity?: (clientX: number, clientY: number, kind: DebugTargetKind) => number | null;
  /** True when a client point is over the HUD, where a click is the HUD's rather than a map spawn. */
  readonly claimPointer: (clientX: number, clientY: number) => boolean;
  /** Localized display name for a good typeId, or `undefined` to keep the catalog's built-in label. */
  readonly goodLabel?: (typeId: number) => string | undefined;
  /** Owner slot to its roster tribe: a spawn is stamped for the slot it is dropped for, so it can work
   *  that slot's buildings. */
  readonly seatTribeOf: (player: number) => number;
  /** Hand the HUD's wall line tool a line of finished walls for an owner; false when it cannot take one.
   *  Absent hides the structures section. */
  readonly enterStandingWall?: (owner: number, tribe: number) => boolean;
  /** Every good the running content defines, each droppable as a loose pile. Live-sourced, so no entry
   *  can trip the sim's `dropGood` content guard. */
  readonly goods: readonly GoodEntry[];
  /** Wildlife entries, each spawnable as its data-pinned herd. Empty or absent hides the section. */
  readonly animals?: readonly AnimalEntry[];
  /** The running content's vehicle types. Empty or absent hides the section. */
  readonly vehicles?: readonly VehicleEntry[];
  /** The sim's live needs-rule state, drawn on the toggle button. */
  readonly needsEnabled?: () => boolean;
  /** The sim's live fog mode. Absent hides the visibility section. */
  readonly fogMode?: () => FogMode;
  readonly geometryEnabled: () => boolean;
  readonly setGeometryEnabled: (enabled: boolean) => void;
  readonly zoomOutUnlocked: () => boolean;
  readonly setZoomOutUnlocked: (unlocked: boolean) => void;
  /** The chip's top edge in client px, under the HUD's top-right bar. */
  readonly top: number;
}

export interface AdminDebugHandle {
  setVisible(visible: boolean): void;
  /** Move the chip, and the panel under it, to `top` client px. */
  place(top: number): void;
  dispose(): void;
}

/** Matches the settler HP the content's tribes carry, so the field shows what an untouched spawn gets. */
const DEFAULT_HITPOINTS = HUMAN_HITPOINTS;

/** Mount the admin/debug spawn palette with its toggle chip showing and the panel closed. */
export function mountAdminDebug(deps: AdminDebugDeps): AdminDebugHandle {
  const { canvas } = deps;
  const msgs = messages();
  const copy = msgs.admin;
  const labels = createAdminLabels(msgs, deps.goodLabel, deps.goods);
  // The goods table in the weapon-lookup seam shape (`GoodEntry` names the typeId `good`).
  const spawnGoods = deps.goods.map((g) => ({ typeId: g.good, id: g.id }));

  let armed: Armed | null = null;
  let player = HUMAN_PLAYER;
  let hitpoints = DEFAULT_HITPOINTS;
  let armorClass = 0; // 0 = unarmored

  const armedButtons: { readonly button: HTMLButtonElement; readonly armed: Armed }[] = [];
  const swatchButtons: { readonly button: HTMLButtonElement; readonly player: number }[] = [];
  const status = el('div', FOOTER_STYLE);

  const refresh = (): void => {
    for (const { button, armed: a } of armedButtons) setButtonActive(button, sameArmed(a, armed));
    for (const { button, player: p } of swatchButtons)
      button.style.outline = p === player ? '2px solid #e8dcc8' : '1px solid #000';
    status.textContent = labels.status(armed, player);
    canvas.style.cursor = armed === null ? '' : 'crosshair';
  };

  const setArmed = (next: Armed | null): void => {
    armed = next;
    refresh();
  };

  const needs = createNeedsToggle({ enqueue: deps.enqueue, needsEnabled: deps.needsEnabled });
  const fog = createFogSwitcher({ enqueue: deps.enqueue, fogMode: deps.fogMode });
  const geometry = createGeometryToggle({
    enabled: deps.geometryEnabled,
    setEnabled: deps.setGeometryEnabled,
  });
  const zoomOut = createZoomOutToggle({
    unlocked: deps.zoomOutUnlocked,
    setUnlocked: deps.setZoomOutUnlocked,
  });

  const panel = el('div', ADMIN_PANEL_STYLE);
  panel.style.display = 'none';

  const toggle = el('button', TOGGLE_STYLE, copy.toggle);
  let open = false;
  const setOpen = (next: boolean): void => {
    open = next;
    panel.style.display = open ? 'flex' : 'none';
    if (!open) setArmed(null); // hiding the panel disarms, so no stray crosshair click survives it
    if (open) {
      needs.refresh(); // the boot value may predate a scene's own toggle
      fog.refresh();
      geometry.refresh();
      zoomOut.refresh();
    }
  };
  toggle.addEventListener('click', () => setOpen(!open));

  const header = el('div', HEADER_STYLE);
  header.append(el('div', 'font-weight:700;font-size:13px;margin-bottom:2px', copy.title));
  header.append(el('div', 'opacity:0.7;font-size:11px;margin-bottom:8px', copy.intro));

  header.append(el('div', SECTION_TITLE_STYLE, copy.playerOwner));
  const swatchRow = el('div', ROW_STYLE);
  for (const s of PLAYER_SWATCHES) {
    const b = el(
      'button',
      `width:26px;height:22px;border-radius:4px;cursor:pointer;background:${s.css};border:1px solid #000`,
    );
    b.title = formatMessage(copy.playerTitle, { player: s.player, name: labels.player(s.player) });
    b.addEventListener('click', () => {
      player = s.player;
      refresh();
    });
    swatchButtons.push({ button: b, player: s.player });
    swatchRow.append(b);
  }
  header.append(swatchRow);

  // Applied to every spawned unit; a vehicle or a resource ignores them.
  const statsRow = el('div', 'display:flex;gap:12px;align-items:center;margin-top:8px;flex-wrap:wrap');
  statsRow.append(
    numberField('HP', DEFAULT_HITPOINTS, (v) => {
      hitpoints = v;
    }),
  );
  statsRow.append(
    selectField(
      copy.armor,
      ARMOR_CLASSES.map((value, index) => ({ value, label: copy.armorClasses[index] ?? String(value) })),
      0,
      (v) => {
        armorClass = v;
      },
    ),
  );
  header.append(statsRow);
  header.append(needs.row);
  if (deps.fogMode !== undefined) {
    header.append(el('div', SECTION_TITLE_STYLE, copy.fog));
    header.append(fog.row);
  }
  header.append(el('div', SECTION_TITLE_STYLE, copy.geometry));
  header.append(geometry.row);
  header.append(el('div', `${SECTION_TITLE_STYLE};margin-top:8px`, copy.camera));
  header.append(zoomOut.row);

  const body = el('div', BODY_STYLE);

  /** Append one collapsible section of arm/disarm buttons, with an optional name filter above the row. */
  const addPaletteSection = (
    title: string,
    entries: readonly { readonly label: string; readonly armed: Armed }[],
    startOpen: boolean,
    filterHint?: string,
  ): void => {
    const section = collapsibleSection(title, entries.length, startOpen);
    const buttons = armEntries(entries);
    if (filterHint !== undefined) section.content.append(filterInput(buttons, filterHint));
    section.content.append(rowOf(buttons));
    body.append(section.wrap);
  };

  // Open by default: the first section a spawn-a-fight session reaches for.
  addPaletteSection(
    copy.warriors,
    WARRIOR_PRESETS.map((preset) => ({ label: labels.unit(preset), armed: { kind: 'unit', preset } })),
    true,
  );
  addPaletteSection(
    copy.civilians,
    CIVILIAN_PRESETS.map((preset) => ({ label: labels.unit(preset), armed: { kind: 'unit', preset } })),
    false,
  );
  const vehicles = deps.vehicles ?? [];
  if (vehicles.length > 0) {
    addPaletteSection(
      copy.vehicles,
      vehicles.map((entry) => ({ label: entry.label, armed: { kind: 'vehicle', entry } })),
      false,
    );
  }
  // A herd is unowned, so the player, HP and armor knobs do not apply to it.
  const animals = deps.animals ?? [];
  if (animals.length > 0) {
    addPaletteSection(
      copy.animals,
      animals.map((entry) => ({ label: labels.animal(entry), armed: { kind: 'animal', entry } })),
      false,
      copy.filterAnimals,
    );
  }
  addPaletteSection(
    copy.resources,
    RESOURCE_ENTRIES.map((r) => ({ label: labels.good(r), armed: { kind: 'resource', good: r.good } })),
    false,
  );
  // Live-sourced, so the palette can never offer a good the sim would refuse to drop.
  addPaletteSection(
    copy.goods,
    deps.goods.map((g) => ({ label: labels.good(g), armed: { kind: 'good', good: g.good } })),
    false,
    copy.filterGoods,
  );
  // The wall line tool keeps its preview and reach; only its commit turns into finished walls.
  const enterStandingWall = deps.enterStandingWall;
  if (enterStandingWall !== undefined) {
    const section = collapsibleSection(copy.structures, 1, false);
    const button = el('button', BUTTON_STYLE, copy.standingPalisade);
    button.addEventListener('click', () => {
      setArmed(null);
      enterStandingWall(player, deps.seatTribeOf(player));
    });
    section.content.append(rowOf([{ button, label: copy.standingPalisade }]));
    body.append(section.wrap);
  }
  // Click-a-target tools, inert without an entity picker.
  addPaletteSection(
    copy.actions,
    DEBUG_ACTIONS.map((action) => ({ label: labels.action(action), armed: { kind: 'action', action } })),
    false,
  );

  panel.append(header, body, status);
  const place = (top: number): void => {
    toggle.style.top = `${top}px`;
    panel.style.top = `${top + PANEL_BELOW_CHIP_PX}px`;
  };
  place(deps.top);
  document.body.append(toggle, panel);
  refresh();

  /** Build one arm/disarm button per entry, registered for the armed-highlight refresh. */
  function armEntries(
    entries: readonly { readonly label: string; readonly armed: Armed }[],
  ): readonly LabelledButton[] {
    return entries.map(({ label, armed: choice }) => {
      const button = el('button', BUTTON_STYLE, label);
      button.addEventListener('click', () => setArmed(sameArmed(choice, armed) ? null : choice));
      armedButtons.push({ button, armed: choice });
      return { button, label };
    });
  }

  const spawnAtTile = (col: number, row: number): void => {
    if (armed === null || armed.kind === 'action') return;
    if (armed.kind === 'animal') {
      deps.enqueue(animalSpawnCommand(armed.entry.tribe, col, row));
      return;
    }
    if (armed.kind === 'resource') {
      const command = resourceCommand(armed.good, col, row);
      if (command !== null) deps.enqueue(command);
      return;
    }
    if (armed.kind === 'good') {
      deps.enqueue(goodDropCommand(armed.good, col, row));
      return;
    }
    if (armed.kind === 'vehicle') {
      const tribe = deps.seatTribeOf(player);
      deps.enqueue(vehicleSpawnCommand(armed.entry.vehicleType, { player, tribe, x: col, y: row }));
      return;
    }
    deps.enqueue(
      unitSpawnCommand(armed.preset, {
        player,
        tribe: deps.seatTribeOf(player),
        hitpoints,
        armorClass,
        x: col,
        y: row,
        goods: spawnGoods,
      }),
    );
  };

  /** Applies to the entity under the cursor; a no-op click when none is there or no picker was handed in. */
  const applyActionAt = (clientX: number, clientY: number, action: DebugAction): void => {
    // Picking is number-typed end to end, so the `Entity` brand is reconstituted at this app-to-sim seam.
    const ref = deps.pickEntity?.(clientX, clientY, action.targetKind) ?? null;
    if (ref !== null) deps.enqueue(action.command(ref as Entity));
  };

  // Capture on `window` runs before the canvas's RTS-control listeners, so an armed press can consume
  // the click and act instead of selecting.
  const onPointerDown = (e: MouseEvent): void => {
    if (armed === null) return;
    if (e.button === 2) {
      setArmed(null);
      e.preventDefault();
      e.stopPropagation(); // do not also fall through to a move or attack order
      return;
    }
    if (e.button !== 0) return; // middle button stays the camera pan
    if (e.target !== canvas) return; // a click on the panel itself, not the map
    if (deps.claimPointer(e.clientX, e.clientY)) return;
    // Consume the armed left-press even when it hits nothing, so it never clears the unit selection.
    if (armed.kind === 'action') {
      applyActionAt(e.clientX, e.clientY, armed.action);
    } else {
      const tile = deps.clientToTile(e.clientX, e.clientY);
      if (tile !== null) spawnAtTile(tile.col, tile.row);
    }
    e.preventDefault();
    e.stopPropagation();
  };
  window.addEventListener('mousedown', onPointerDown, { capture: true });

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Escape' && armed !== null) {
      setArmed(null);
      e.stopPropagation(); // don't also clear the unit selection (unit-controls' Esc)
    }
  };
  window.addEventListener('keydown', onKeyDown, { capture: true });

  return {
    setVisible(visible): void {
      toggle.style.display = visible ? '' : 'none';
      if (!visible && open) setOpen(false);
    },
    place,
    dispose(): void {
      window.removeEventListener('mousedown', onPointerDown, { capture: true });
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      toggle.remove();
      panel.remove();
    },
  };
}
