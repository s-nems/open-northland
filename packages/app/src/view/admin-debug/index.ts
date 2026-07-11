import { type Command, type Entity, FOG_MODE, systems } from '@vinland/sim';
import { HUMAN_PLAYER } from '../../game/rules.js';
import { resourceCommand } from '../../game/sandbox/place.js';
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
import {
  ARMOR_CLASSES,
  CIVILIAN_PRESETS,
  GOODS_ENTRIES,
  goodDropCommand,
  PLAYER_SWATCHES,
  RESOURCE_ENTRIES,
  type UnitPreset,
  unitSpawnCommand,
  WARRIOR_PRESETS,
} from './spawn-catalog.js';

/**
 * The **admin / debug spawn palette** — a hideable panel (a top toggle button) that lets a human drop
 * test entities by clicking the map (any soldier class with its weapon, any civilian, any resource node
 * or good, each owned by a chosen player) AND run **entity-action tools** on what's already there (kill a
 * unit, drive its needs to full/empty, fill a warehouse, finish a construction site). It exists so combat,
 * ownership, economy and lifecycle can be exercised on a live map without hand-authoring a scene — "spawn
 * a few of mine, a few enemies, fill their stores, watch them fight".
 *
 * Everything goes through the ONE sim command seam (`spawnSettler` / `placeResource` / the `debug*`
 * commands), so a debug poke is as replay-faithful as any player order — the panel never touches
 * `sim.world` directly (app one-way flow, packages/app/AGENTS.md). It is a pure app-layer DOM overlay,
 * mounted once and never torn down; its two `window` capture listeners persist for the page's life, which
 * is safe because `startGameView` runs exactly once per page load (a scene switch is a full reload).
 *
 * Layout: the panel is a **right-docked rail** (never the screen centre — it must not hide the map it
 * acts on), a fixed-height flex column — a static header carrying the spawn "stamp" settings (owner / HP /
 * armor / needs), a scrolling body of **collapsible palette sections** (only the section in use need be
 * open — the goods list alone is ~70 entries, so it also carries a name filter), and a pinned status
 * footer that always shows what the next click will do (see {@link import('./chrome.js')}).
 *
 * Interaction: click a palette / action button to ARM it (the cursor becomes a crosshair). A spawn arm
 * places at each clicked TILE; an action arm applies to the ENTITY clicked (a unit or a building, per the
 * action). Arming is STICKY so a battle line — or a sweep of kills — is done with repeated clicks. Switch
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
   *  catalog's built-in label. Localizes the goods/resource palette from the ONE name source the HUD uses. */
  readonly goodLabel?: (typeId: number) => string | undefined;
  /** The sim's live needs-rule state — drawn on the "Potrzeby" toggle button so it reflects the entry's
   *  default (scenes boot needs OFF, maps ON). The toggle itself goes through `enqueue` like any command. */
  readonly needsEnabled?: () => boolean;
  /** The sim's live fog-of-war mode (`FOG_MODE.*`) — highlights the active mode button; switching goes
   *  through `enqueue` (`setFogMode`) like any command. Absent hides the fog section. */
  readonly fogMode?: () => number;
}

/** The admin fog switcher's mode buttons — every `FOG_MODE` with a human label. */
const FOG_MODE_BUTTONS: readonly { readonly mode: number; readonly label: string }[] = [
  { mode: FOG_MODE.OFF, label: 'Wyłączona' },
  { mode: FOG_MODE.REVEAL, label: 'Reveal (odkryte zostaje)' },
  { mode: FOG_MODE.RECON, label: 'Recon (teren znany)' },
  { mode: FOG_MODE.FULL, label: 'Full (klasyczna)' },
];

/** What the next map click will do. */
type Armed =
  | { readonly kind: 'unit'; readonly preset: UnitPreset }
  | { readonly kind: 'resource'; readonly good: number }
  | { readonly kind: 'good'; readonly good: number }
  | { readonly kind: 'action'; readonly action: DebugAction };

/** The default hitpoint pool shown in the HP field — the sim's own settler default, so the palette's
 *  number matches what an untouched spawn would get anyway. */
const DEFAULT_HITPOINTS = systems.DEFAULT_SETTLER_HITPOINTS;

/** The Polish noun for what an action tool clicks — the armed hint tells the human what to target. Keyed by
 *  {@link DebugTargetKind} so a new target kind is a compile error here until it gets its noun. */
const TARGET_NOUN: Record<DebugTargetKind, string> = {
  settler: 'jednostkę',
  building: 'budynek',
};

/** Mount the admin/debug spawn palette (toggle button + hidden panel). Mount-and-forget. */
export function mountAdminDebug(deps: AdminDebugDeps): void {
  const { canvas } = deps;

  // Resolve a good's palette label through the shared localized name source, keeping the catalog's built-in
  // label as the fallback (a bare checkout with no name tables, or a good the source doesn't name).
  const goodLabelOf = (good: number, fallback: string): string => deps.goodLabel?.(good) ?? fallback;

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
    if (armed === null) return 'Nic nie wybrano — kliknij jednostkę / surowiec / towar / narzędzie powyżej.';
    if (armed.kind === 'resource') {
      const good = armed.good;
      const label = goodLabelOf(good, RESOURCE_ENTRIES.find((r) => r.good === good)?.label ?? 'surowiec');
      return `Uzbrojono: złoże „${label}" — klikaj na mapie (PPM/Esc = anuluj).`;
    }
    if (armed.kind === 'good') {
      const good = armed.good;
      const label = goodLabelOf(good, GOODS_ENTRIES.find((g) => g.good === good)?.label ?? 'towar');
      return `Uzbrojono: towar „${label}" (stos na ziemi) — klikaj na mapie (PPM/Esc = anuluj).`;
    }
    if (armed.kind === 'action') {
      return `Uzbrojono: ${armed.action.label} — kliknij ${TARGET_NOUN[armed.action.targetKind]} (PPM/Esc = anuluj).`;
    }
    const who = PLAYER_SWATCHES.find((s) => s.player === player);
    return `Uzbrojono: ${armed.preset.label} (gracz ${player} — ${who?.name ?? '?'}) — klikaj na mapie (PPM/Esc = anuluj).`;
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

  // The global needs toggle ("wyłącz potrzeby" — user decision 2026-07-11): flips the sim's
  // setNeedsEnabled rule so test units don't starve mid-session. Scenes boot with needs OFF, maps ON.
  // The label re-reads the live rule every time the admin panel OPENS (the mount-time value may
  // predate the scene's own boot toggle, and another surface could flip the rule later); after a
  // click it tracks the value just requested — the command applies next tick, well before another
  // click can land.
  const needsButton = el('button', BUTTON_STYLE);
  let needsOn = deps.needsEnabled?.() ?? true;
  const paintNeedsButton = (): void => {
    needsButton.textContent = needsOn
      ? 'Potrzeby: WŁĄCZONE (klik = wyłącz)'
      : 'Potrzeby: WYŁĄCZONE (klik = włącz)';
    setButtonActive(needsButton, needsOn);
  };
  const refreshNeedsButton = (): void => {
    needsOn = deps.needsEnabled?.() ?? needsOn;
    paintNeedsButton();
  };
  needsButton.addEventListener('click', () => {
    needsOn = !needsOn;
    deps.enqueue({ kind: 'setNeedsEnabled', enabled: needsOn });
    paintNeedsButton();
  });
  paintNeedsButton();
  const needsRow = el('div', 'display:flex;gap:8px;align-items:center;margin-top:8px');
  needsRow.append(el('span', 'opacity:0.8', 'Głód/sen itd.'));
  needsRow.append(needsButton);

  // The fog-of-war mode switcher (the same live-rule pattern as the needs toggle): one button per
  // FOG_MODE, the active one highlighted from the sim's sanctioned read; a click enqueues `setFogMode`
  // and tracks the requested mode (applies next tick, before another click can land).
  const fogButtons: { readonly button: HTMLButtonElement; readonly mode: number }[] = [];
  let activeFogMode = deps.fogMode?.() ?? FOG_MODE.OFF;
  const paintFogButtons = (): void => {
    for (const { button, mode } of fogButtons) setButtonActive(button, mode === activeFogMode);
  };
  const refreshFogButtons = (): void => {
    activeFogMode = deps.fogMode?.() ?? activeFogMode;
    paintFogButtons();
  };
  const fogRow = el('div', ROW_STYLE);
  for (const { mode, label } of FOG_MODE_BUTTONS) {
    const b = el('button', BUTTON_STYLE, label);
    b.addEventListener('click', () => {
      activeFogMode = mode;
      deps.enqueue({ kind: 'setFogMode', mode });
      paintFogButtons();
    });
    fogButtons.push({ button: b, mode });
    fogRow.append(b);
  }
  paintFogButtons();

  // ---- DOM: right-docked flex column (header · scrolling body · status footer) ----
  const panel = el('div', ADMIN_PANEL_STYLE);
  panel.style.display = 'none';

  const toggle = el('button', TOGGLE_STYLE, '🛠 Admin / Debug');
  let open = false;
  toggle.addEventListener('click', () => {
    open = !open;
    panel.style.display = open ? 'flex' : 'none';
    if (!open) setArmed(null); // hiding the panel disarms (a stray crosshair click is confusing)
    if (open) {
      refreshNeedsButton(); // re-read the live rules — the boot value may predate a scene's toggle
      refreshFogButtons();
    }
  });

  // --- static header: title + spawn "stamp" settings (owner / HP / armor / needs) ---
  const header = el('div', HEADER_STYLE);
  header.append(el('div', 'font-weight:700;font-size:13px;margin-bottom:2px', 'Panel Admina / Debug'));
  header.append(
    el(
      'div',
      'opacity:0.7;font-size:11px;margin-bottom:8px',
      'Wybierz jednostkę / złoże / towar / narzędzie, potem klikaj na mapie. Zmieniaj gracza między klikami, by ustawić obie strony.',
    ),
  );

  // Player swatches.
  header.append(el('div', SECTION_TITLE_STYLE, 'Gracz (właściciel)'));
  const swatchRow = el('div', ROW_STYLE);
  for (const s of PLAYER_SWATCHES) {
    const b = el(
      'button',
      `width:26px;height:22px;border-radius:4px;cursor:pointer;background:${s.css};border:1px solid #000`,
    );
    b.title = `Gracz ${s.player} (${s.name})`;
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
    selectField('Pancerz', ARMOR_CLASSES, 0, (v) => {
      armorClass = v;
    }),
  );
  header.append(statsRow);
  header.append(needsRow);
  if (deps.fogMode !== undefined) {
    header.append(el('div', SECTION_TITLE_STYLE, 'Mgła wojny'));
    header.append(fogRow);
  }

  // --- scrolling body: collapsible palette + action sections ---
  const body = el('div', BODY_STYLE);

  // Wojownicy (open by default — the first thing a "spawn a fight" session reaches for).
  const warriors = collapsibleSection('Wojownicy', WARRIOR_PRESETS.length, true);
  warriors.content.append(
    rowOf(
      armEntries(WARRIOR_PRESETS.map((preset) => ({ label: preset.label, armed: { kind: 'unit', preset } }))),
    ),
  );
  body.append(warriors.wrap);

  const civilians = collapsibleSection('Cywile', CIVILIAN_PRESETS.length, false);
  civilians.content.append(
    rowOf(
      armEntries(
        CIVILIAN_PRESETS.map((preset) => ({ label: preset.label, armed: { kind: 'unit', preset } })),
      ),
    ),
  );
  body.append(civilians.wrap);

  const resources = collapsibleSection('Złoża (do wydobycia)', RESOURCE_ENTRIES.length, false);
  resources.content.append(
    rowOf(
      armEntries(
        RESOURCE_ENTRIES.map((r) => ({
          label: goodLabelOf(r.good, r.label),
          armed: { kind: 'resource', good: r.good },
        })),
      ),
    ),
  );
  body.append(resources.wrap);

  // Towary — every good in the catalog dropped as a loose ground pile (`dropGood`). ~70 entries, so a
  // name filter narrows the wall to what the human is after (the goods tool mirrors this list).
  const goods = collapsibleSection('Towary (stos na ziemi)', GOODS_ENTRIES.length, false);
  const goodButtons = armEntries(
    GOODS_ENTRIES.map((g) => ({
      label: goodLabelOf(g.good, g.label),
      armed: { kind: 'good', good: g.good },
    })),
  );
  goods.content.append(filterInput(goodButtons, 'Filtruj towary…'), rowOf(goodButtons));
  body.append(goods.wrap);

  // Akcje debug — click-a-target tools (kill / needs / fill / finish). Inert if the host wired no
  // entity picker (they need a clicked entity, not a tile); the section header still shows the count.
  const actions = collapsibleSection('Akcje (klik w cel)', DEBUG_ACTIONS.length, false);
  actions.content.append(
    rowOf(
      armEntries(DEBUG_ACTIONS.map((action) => ({ label: action.label, armed: { kind: 'action', action } }))),
    ),
  );
  body.append(actions.wrap);

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
  /** A spawn arm places at a TILE; the loose-good/resource/unit variants each map to their command. */
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
    deps.enqueue(unitSpawnCommand(armed.preset, { player, hitpoints, armorClass, x: col, y: row }));
  };

  /** An action arm applies to the ENTITY under the cursor (a no-op click if none is there / no picker). */
  const applyActionAt = (clientX: number, clientY: number, action: DebugAction): void => {
    // A snapshot pick returns the raw entity id; it IS the branded `Entity` (picking is number-typed
    // end-to-end), reconstituted at this one app→sim seam before the command carries it.
    const ref = deps.pickEntity?.(clientX, clientY, action.targetKind) ?? null;
    if (ref !== null) deps.enqueue(action.command(ref as Entity));
  };

  // A WINDOW-CAPTURE mousedown runs BEFORE the canvas's RTS-control listeners (capture phase precedes
  // the target phase), so when armed it can consume the press and act instead of selecting. When not
  // armed it returns without consuming, leaving the normal controls untouched.
  const onPointerDown = (e: MouseEvent): void => {
    if (armed === null) return;
    if (e.button === 2) {
      setArmed(null); // right-click cancels arming …
      e.preventDefault();
      e.stopPropagation(); // … and does NOT fall through to a move/attack order
      return;
    }
    if (e.button !== 0) return; // middle button stays the camera pan
    if (e.target !== canvas) return; // a click on the panel itself, not the map
    if (deps.claimPointer(e.clientX, e.clientY)) return; // over the HUD — let the HUD have it
    // From here the armed left-press is OURS: consume it so it never falls through to selection, even
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
