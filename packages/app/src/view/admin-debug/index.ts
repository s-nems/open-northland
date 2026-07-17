import type { Command, Entity } from '@open-northland/sim';
import { HUMAN_HITPOINTS } from '../../catalog/units.js';
import { HUMAN_PLAYER } from '../../game/rules.js';
import { resourceCommand } from '../../game/sandbox/place.js';
import { formatMessage, type Messages, messages, professionLabel } from '../../i18n/index.js';
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
  ROW_STYLE,
  rowOf,
  SECTION_TITLE_STYLE,
  selectField,
  setButtonActive,
  TOGGLE_STYLE,
} from './chrome.js';
import { createFogSwitcher, createGeometryToggle, createNeedsToggle } from './live-toggles.js';
import {
  ARMOR_CLASSES,
  CIVILIAN_PRESETS,
  type GoodEntry,
  goodDropCommand,
  PLAYER_SWATCHES,
  RESOURCE_ENTRIES,
  type UnitPreset,
  unitSpawnCommand,
  WARRIOR_PRESETS,
} from './spawn-catalog.js';

/**
 * The admin / debug spawn palette — a hideable panel (a top toggle button) that lets a human drop
 * test entities by clicking the map (any soldier class with its weapon, any civilian, any resource node
 * or good, each owned by a chosen player) and run entity-action tools on what's already there (kill a
 * unit, drive its needs to full/empty, fill a warehouse, finish a construction site). It exists so combat,
 * ownership, economy and lifecycle can be exercised on a live map without hand-authoring a scene.
 *
 * Everything goes through the one sim command seam (`spawnSettler` / `placeResource` / the `debug*`
 * commands), so a debug poke is as replay-faithful as any player order — the panel never touches
 * `sim.world` directly (app one-way flow, packages/app/AGENTS.md). It is a pure app-layer DOM overlay,
 * mounted once and never torn down; its two `window` capture listeners persist for the page's life, which
 * is safe because `startGameView` runs exactly once per page load (a scene switch is a full reload).
 *
 * Layout: the panel is a right-docked rail (never the screen centre — it must not hide the map it
 * acts on), a fixed-height flex column — a static header carrying the spawn "stamp" settings (owner / HP /
 * armor / needs), a scrolling body of collapsible palette sections (only the section in use need be open),
 * and a pinned status footer that always shows what the next click will do (see {@link import('./chrome.js')}).
 *
 * Interaction: click a palette / action button to arm it (the cursor becomes a crosshair). A spawn arm
 * places at each clicked tile; an action arm applies to the entity clicked (a unit or a building, per the
 * action). Arming is sticky so a battle line — or a sweep of kills — is done with repeated clicks. Switch
 * the player swatch between spawn clicks to seed both sides. Right-click or Esc disarms. The armed press is
 * consumed (a window-capture listener before the RTS controls), so arming never also selects/orders units.
 */

export interface AdminDebugDeps {
  readonly canvas: HTMLCanvasElement;
  /** Submit a command into the sim (the one-way seam). */
  readonly enqueue: (command: Command) => void;
  /** Map a client point to a map tile (null off the map) — shared with the tool panel's placement. */
  readonly clientToTile: (clientX: number, clientY: number) => { col: number; row: number } | null;
  /** Pick the top entity of `kind` under a client point (null off any) — the target for an entity-action
   *  tool (kill / needs / fill / finish). Any owner (so an enemy is killable), unlike the RTS selection.
   *  Absent → the action tools are inert (no entity to act on). */
  readonly pickEntity?: (clientX: number, clientY: number, kind: DebugTargetKind) => number | null;
  /** True when a client point is over the HUD (the tool-panel strip / an open window) — a spawn click
   *  there is the HUD's, not a map spawn. */
  readonly claimPointer: (clientX: number, clientY: number) => boolean;
  /** The localized display name for a good typeId (from the shared sim content), or `undefined` to keep the
   *  catalog's built-in label. Localizes the goods/resource palette from the one name source the HUD uses. */
  readonly goodLabel?: (typeId: number) => string | undefined;
  /** Every good the running content defines (`sim.content.goods` → its typeId + string id), each droppable
   *  as a loose ground pile. Driven from the live content so the palette always matches whatever the view
   *  runs (sandbox or the real extracted goods) and every entry clears the sim's `dropGood` content guard. */
  readonly goods: readonly GoodEntry[];
  /** The sim's live needs-rule state — drawn on the "Potrzeby" toggle button so it reflects the entry's
   *  default (scenes boot needs OFF, maps ON). The toggle itself goes through `enqueue` like any command. */
  readonly needsEnabled?: () => boolean;
  /** The sim's live fog-of-war mode (`FOG_MODE.*`) — highlights the active mode button; switching goes
   *  through `enqueue` (`setFogMode`) like any command. Absent hides the fog section. */
  readonly fogMode?: () => number;
  readonly geometryEnabled: () => boolean;
  readonly setGeometryEnabled: (enabled: boolean) => void;
}

/** What the next map click will do. */
type Armed =
  | { readonly kind: 'unit'; readonly preset: UnitPreset }
  | { readonly kind: 'resource'; readonly good: number }
  | { readonly kind: 'good'; readonly good: number }
  | { readonly kind: 'action'; readonly action: DebugAction };

/** The default hitpoint pool shown in the HP field — the clean-room settler HP the content's tribes carry
 *  ({@link HUMAN_HITPOINTS}), so the palette's number matches what an untouched spawn gets from its tribe. */
const DEFAULT_HITPOINTS = HUMAN_HITPOINTS;

/** Mount the admin/debug spawn palette (toggle button + hidden panel). Mount-and-forget. */
export function mountAdminDebug(deps: AdminDebugDeps): void {
  const { canvas } = deps;
  const copy = messages().admin;
  const goodNames = messages().goods;
  const targetNoun: Record<DebugTargetKind, string> = {
    settler: copy.targetSettler,
    building: copy.targetBuilding,
  };

  // Resolve a good's palette label through the shared localized name source, keeping the catalog's built-in
  // label as the fallback (a bare checkout with no name tables, or a good the source doesn't name).
  const goodLabelOf = (good: number, fallback: string): string => deps.goodLabel?.(good) ?? fallback;
  const localizedGood = (entry: { readonly good: number; readonly id: string }): string =>
    goodLabelOf(entry.good, goodNames[entry.id as keyof Messages['goods']] ?? entry.id);
  const unitLabel = (preset: UnitPreset): string => {
    const direct = copy.units[preset.id as keyof Messages['admin']['units']];
    if (direct !== undefined) return direct;
    if (preset.id === 'collector') return professionLabel('collector');
    return preset.id;
  };
  const actionLabel = (action: DebugAction): string => copy.actionsCatalog[action.id];
  const playerName = (player: number): string => messages().animation.playerColors[player] ?? String(player);

  // ---- spawn state ---------------------------------------------------------
  let armed: Armed | null = null;
  let player = HUMAN_PLAYER; // the human/blue player by default
  let hitpoints = DEFAULT_HITPOINTS;
  let armorClass = 0; // 0 = unarmored

  // Buttons that reflect the armed choice + the player swatches, re-styled whenever state changes.
  const armedButtons: { readonly button: HTMLButtonElement; readonly armed: Armed }[] = [];
  const swatchButtons: { readonly button: HTMLButtonElement; readonly player: number }[] = [];
  const status = el('div', FOOTER_STYLE);

  const sameArmed = (a: Armed, b: Armed | null): boolean => {
    if (b === null) return false;
    if (a.kind === 'unit' && b.kind === 'unit') return a.preset.id === b.preset.id;
    if (a.kind === 'resource' && b.kind === 'resource') return a.good === b.good;
    if (a.kind === 'good' && b.kind === 'good') return a.good === b.good;
    if (a.kind === 'action' && b.kind === 'action') return a.action.id === b.action.id;
    return false;
  };

  const armedLabel = (): string => {
    if (armed === null) return copy.nothingArmed;
    if (armed.kind === 'resource') {
      const good = armed.good;
      const entry = RESOURCE_ENTRIES.find((candidate) => candidate.good === good);
      const label = entry === undefined ? copy.resourceFallback : localizedGood(entry);
      return formatMessage(copy.armedResource, { label });
    }
    if (armed.kind === 'good') {
      const good = armed.good;
      const entry = deps.goods.find((candidate) => candidate.good === good);
      const label = entry === undefined ? copy.goodFallback : localizedGood(entry);
      return formatMessage(copy.armedGood, { label });
    }
    if (armed.kind === 'action') {
      return formatMessage(copy.armedAction, {
        label: actionLabel(armed.action),
        target: targetNoun[armed.action.targetKind],
      });
    }
    const who = PLAYER_SWATCHES.find((s) => s.player === player);
    return formatMessage(copy.armedUnit, {
      label: unitLabel(armed.preset),
      player,
      name: who === undefined ? '?' : playerName(who.player),
    });
  };

  const refresh = (): void => {
    for (const { button, armed: a } of armedButtons) setButtonActive(button, sameArmed(a, armed));
    for (const { button, player: p } of swatchButtons)
      button.style.outline = p === player ? '2px solid #e8dcc8' : '1px solid #000';
    status.textContent = armedLabel();
    canvas.style.cursor = armed === null ? '' : 'crosshair';
  };

  const setArmed = (next: Armed | null): void => {
    armed = next;
    refresh();
  };

  // The live-rule toggle widgets — the global needs toggle + the fog-of-war mode switcher. Each builds a
  // DOM row, enqueues its command on click, and re-reads the live rule when the panel opens (see
  // live-toggles.ts). They have no coupling to the arming state, so they live apart from it.
  const needs = createNeedsToggle({ enqueue: deps.enqueue, needsEnabled: deps.needsEnabled });
  const fog = createFogSwitcher({ enqueue: deps.enqueue, fogMode: deps.fogMode });
  const geometry = createGeometryToggle({
    enabled: deps.geometryEnabled,
    setEnabled: deps.setGeometryEnabled,
  });

  // ---- DOM: right-docked flex column (header · scrolling body · status footer) ----
  const panel = el('div', ADMIN_PANEL_STYLE);
  panel.style.display = 'none';

  const toggle = el('button', TOGGLE_STYLE, copy.toggle);
  let open = false;
  toggle.addEventListener('click', () => {
    open = !open;
    panel.style.display = open ? 'flex' : 'none';
    if (!open) setArmed(null); // hiding the panel disarms (a stray crosshair click is confusing)
    if (open) {
      needs.refresh(); // re-read the live rules — the boot value may predate a scene's toggle
      fog.refresh();
      geometry.refresh();
    }
  });

  // --- static header: title + spawn "stamp" settings (owner / HP / armor / needs) ---
  const header = el('div', HEADER_STYLE);
  header.append(el('div', 'font-weight:700;font-size:13px;margin-bottom:2px', copy.title));
  header.append(el('div', 'opacity:0.7;font-size:11px;margin-bottom:8px', copy.intro));

  // Player swatches.
  header.append(el('div', SECTION_TITLE_STYLE, copy.playerOwner));
  const swatchRow = el('div', ROW_STYLE);
  for (const s of PLAYER_SWATCHES) {
    const b = el(
      'button',
      `width:26px;height:22px;border-radius:4px;cursor:pointer;background:${s.css};border:1px solid #000`,
    );
    b.title = formatMessage(copy.playerTitle, { player: s.player, name: playerName(s.player) });
    b.addEventListener('click', () => {
      player = s.player;
      refresh();
    });
    swatchButtons.push({ button: b, player: s.player });
    swatchRow.append(b);
  }
  header.append(swatchRow);

  // HP + armor (applied to every spawned unit; a resource ignores them).
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

  // --- scrolling body: collapsible palette + action sections ---
  const body = el('div', BODY_STYLE);

  /** Append one collapsible palette section: a titled row of arm/disarm buttons, with an optional name
   *  filter above the row (the ~70-entry goods wall). */
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

  // Wojownicy open by default — the first thing a "spawn a fight" session reaches for.
  addPaletteSection(
    copy.warriors,
    WARRIOR_PRESETS.map((preset) => ({ label: unitLabel(preset), armed: { kind: 'unit', preset } })),
    true,
  );
  addPaletteSection(
    copy.civilians,
    CIVILIAN_PRESETS.map((preset) => ({ label: unitLabel(preset), armed: { kind: 'unit', preset } })),
    false,
  );
  addPaletteSection(
    copy.resources,
    RESOURCE_ENTRIES.map((r) => ({ label: localizedGood(r), armed: { kind: 'resource', good: r.good } })),
    false,
  );
  // Towary — every good the running content defines, dropped as a loose ground pile (`dropGood`); the name
  // filter narrows the ~70-entry wall. Sourced from the live content so the palette can't offer a good the
  // sim would refuse to drop (the mismatch when a sandbox-scoped list met real content).
  addPaletteSection(
    copy.goods,
    deps.goods.map((g) => ({ label: localizedGood(g), armed: { kind: 'good', good: g.good } })),
    false,
    copy.filterGoods,
  );
  // Akcje debug — click-a-target tools (kill / needs / fill / finish); inert without an entity picker.
  addPaletteSection(
    copy.actions,
    DEBUG_ACTIONS.map((action) => ({ label: actionLabel(action), armed: { kind: 'action', action } })),
    false,
  );

  panel.append(header, body, status);
  document.body.append(toggle, panel);
  refresh();

  /** Build one arm/disarm button per entry (registering each for the armed-highlight refresh). */
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

  // ---- apply on map click --------------------------------------------------
  /** A spawn arm places at a tile; the loose-good/resource/unit variants each map to their command. */
  const spawnAtTile = (col: number, row: number): void => {
    if (armed === null || armed.kind === 'action') return;
    if (armed.kind === 'resource') {
      const command = resourceCommand(armed.good, col, row);
      if (command !== null) deps.enqueue(command);
      return;
    }
    if (armed.kind === 'good') {
      deps.enqueue(goodDropCommand(armed.good, col, row));
      return;
    }
    deps.enqueue(
      unitSpawnCommand(armed.preset, {
        player,
        hitpoints,
        armorClass,
        x: col,
        y: row,
        goods: deps.goods.map((g) => ({ typeId: g.good, id: g.id })),
      }),
    );
  };

  /** An action arm applies to the entity under the cursor (a no-op click if none is there / no picker). */
  const applyActionAt = (clientX: number, clientY: number, action: DebugAction): void => {
    // A snapshot pick returns the raw entity id; it is the branded `Entity` (picking is number-typed
    // end-to-end), reconstituted at this one app→sim seam before the command carries it.
    const ref = deps.pickEntity?.(clientX, clientY, action.targetKind) ?? null;
    if (ref !== null) deps.enqueue(action.command(ref as Entity));
  };

  // A window-capture mousedown runs before the canvas's RTS-control listeners (capture phase precedes
  // the target phase), so when armed it can consume the press and act instead of selecting. When not
  // armed it returns without consuming, leaving the normal controls untouched.
  const onPointerDown = (e: MouseEvent): void => {
    if (armed === null) return;
    if (e.button === 2) {
      setArmed(null); // right-click cancels arming …
      e.preventDefault();
      e.stopPropagation(); // … and does not fall through to a move/attack order
      return;
    }
    if (e.button !== 0) return; // middle button stays the camera pan
    if (e.target !== canvas) return; // a click on the panel itself, not the map
    if (deps.claimPointer(e.clientX, e.clientY)) return; // over the HUD — let the HUD have it
    // From here the armed left-press is ours: consume it so it never falls through to selection, even
    // when it hits nothing (no spawn/target there, but no stray "click empty ground = clear selection").
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
}
