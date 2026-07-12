import { type Command, systems } from '@vinland/sim';
import { HUMAN_PLAYER } from '../../game/rules.js';
import { resourceCommand } from '../../game/sandbox/place.js';
import { BUTTON_STYLE, el } from '../overlay.js';
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
 * test entities by clicking the map: any soldier class with its weapon, any civilian, or any resource
 * node, each owned by a chosen player. It exists so combat, ownership and gathering can be exercised on
 * a live map without hand-authoring a scene — "spawn a few of mine, a few enemies, watch them fight".
 *
 * Everything spawns through the ONE sim command seam (`spawnSettler` / `placeResource`), so a debug
 * spawn is as replay-faithful as any player order — the panel never pokes `sim.world` directly (app
 * one-way flow, packages/app/AGENTS.md). It is a pure app-layer DOM overlay, mounted once and never torn
 * down; its two `window` capture listeners persist for the page's life, which is safe because
 * `startGameView` runs exactly once per page load (a scene switch is a full navigation/reload).
 *
 * Layout: the panel is a **right-docked rail** (never the screen centre — it must not hide the map it
 * spawns onto) laid out as a fixed-height flex column: a static header carrying the spawn "stamp"
 * settings (owner / HP / armor / needs) stays on top, a scrolling body of **collapsible palette
 * sections** takes the middle (only the section in use need be open — the goods list alone is ~70
 * entries, so it also carries a name filter), and a pinned status footer at the bottom always shows what
 * the next click will place.
 *
 * Interaction: click a unit/resource button to ARM that choice (the cursor becomes a crosshair); each
 * left-click on the map then spawns it at that tile — arming is STICKY so a battle line is placed with
 * repeated clicks. Switch the player swatch between clicks to seed both sides. Right-click or Esc
 * disarms. The spawn press is consumed (a window-capture listener that runs before the RTS controls),
 * so arming never also selects/orders units.
 */

export interface AdminDebugDeps {
  readonly canvas: HTMLCanvasElement;
  /** Submit a command into the sim (the one-way seam). */
  readonly enqueue: (command: Command) => void;
  /** Map a client point to a map tile (null off the map) — shared with the tool panel's placement. */
  readonly clientToTile: (clientX: number, clientY: number) => { col: number; row: number } | null;
  /** True when a client point is over the HUD (the tool-panel strip / an open window) — a spawn click
   *  there is the HUD's, not a map spawn. */
  readonly claimPointer: (clientX: number, clientY: number) => boolean;
  /** The localized display name for a good typeId (from the shared sim content), or `undefined` to keep the
   *  catalog's built-in label. Localizes the goods/resource palette from the ONE name source the HUD uses. */
  readonly goodLabel?: (typeId: number) => string | undefined;
  /** The sim's live needs-rule state — drawn on the "Potrzeby" toggle button so it reflects the entry's
   *  default (scenes boot needs OFF, maps ON). The toggle itself goes through `enqueue` like any command. */
  readonly needsEnabled?: () => boolean;
}

/** What the next map click will place. */
type Armed =
  | { readonly kind: 'unit'; readonly preset: UnitPreset }
  | { readonly kind: 'resource'; readonly good: number }
  | { readonly kind: 'good'; readonly good: number };

/** The default hitpoint pool shown in the HP field — the sim's own settler default, so the palette's
 *  number matches what an untouched spawn would get anyway. */
const DEFAULT_HITPOINTS = systems.DEFAULT_SETTLER_HITPOINTS;

/** The rail width — narrow enough to leave the map readable beside it. */
const PANEL_WIDTH_PX = 300;

const TOGGLE_STYLE = [
  'position:fixed',
  'top:8px',
  // Centred over the rail that opens below it (rail: right:8px, width PANEL_WIDTH_PX; chip ~140px wide).
  `right:${8 + PANEL_WIDTH_PX / 2 - 70}px`,
  'cursor:pointer',
  'padding:6px 14px',
  'background:rgba(20,16,12,0.92)',
  'color:#e8dcc8',
  'font:13px ui-monospace,SFMono-Regular,Menlo,monospace',
  'border:1px solid #8a6f4c',
  'border-radius:6px',
  'box-shadow:0 4px 16px rgba(0,0,0,0.45)',
  'z-index:160',
].join(';');

// A right-docked, full-height flex column: header + settings stay put while only the body scrolls.
const ADMIN_PANEL_STYLE = [
  'position:fixed',
  'top:44px',
  'right:8px',
  'bottom:8px',
  `width:${PANEL_WIDTH_PX}px`,
  'display:flex',
  'flex-direction:column',
  'box-sizing:border-box',
  'background:rgba(20,16,12,0.95)',
  'color:#e8dcc8',
  'font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace',
  'border:1px solid #6b5840',
  'border-radius:8px',
  'box-shadow:0 6px 24px rgba(0,0,0,0.5)',
  'z-index:150',
].join(';');

/** The static (non-scrolling) header + settings block. */
const HEADER_STYLE = 'padding:10px 12px 8px;border-bottom:1px solid #5a4a36';
/** The scrolling palette body — the only part that grows/scrolls. */
const BODY_STYLE = 'flex:1;min-height:0;overflow-y:auto;padding:0 12px';
/** The pinned status footer. */
const FOOTER_STYLE = 'padding:8px 12px;border-top:1px solid #5a4a36;min-height:16px';

const SECTION_TITLE_STYLE =
  'font-weight:700;font-size:10px;letter-spacing:0.07em;text-transform:uppercase;opacity:0.6;margin:0 0 6px';
const ROW_STYLE = 'display:flex;flex-wrap:wrap;gap:4px';

/** A collapsible-section header (the clickable "▸ Title (n)" bar). */
const SECTION_HEADER_STYLE = [
  'display:flex',
  'align-items:center',
  'gap:6px',
  'width:100%',
  'cursor:pointer',
  'background:none',
  'border:none',
  'border-top:1px solid #5a4a36',
  'color:#e8dcc8',
  'padding:9px 2px',
  'margin:0',
  'text-align:left',
  'font:700 10px/1 ui-monospace,SFMono-Regular,Menlo,monospace',
  'letter-spacing:0.07em',
  'text-transform:uppercase',
].join(';');

/** The armed-button highlight (brighter than the resting `BUTTON_STYLE`). */
function setButtonActive(button: HTMLButtonElement, active: boolean): void {
  button.style.background = active ? '#6b5840' : '#3a2f22';
  button.style.fontWeight = active ? '700' : '400';
  button.style.outline = active ? '1px solid #d8ccb0' : 'none';
}

/**
 * A collapsible section: a clickable "▸/▾ Title (count)" header over a hideable content box. Returns the
 * wrapper (append to the body) and the `content` element (append the section's rows to it). Only the
 * section a human is actually using need be open, so the rail stays short instead of one long wall.
 */
function collapsibleSection(
  title: string,
  count: number,
  startOpen: boolean,
): { readonly wrap: HTMLElement; readonly content: HTMLElement } {
  const wrap = el('div', '');
  const header = el('button', SECTION_HEADER_STYLE);
  const caret = el('span', 'opacity:0.7;width:10px;display:inline-block', startOpen ? '▾' : '▸');
  header.append(caret, el('span', 'flex:1', title), el('span', 'opacity:0.5;font-weight:400', String(count)));
  const content = el('div', `padding-bottom:8px;${startOpen ? '' : 'display:none'}`);
  let open = startOpen;
  header.addEventListener('click', () => {
    open = !open;
    content.style.display = open ? 'block' : 'none';
    caret.textContent = open ? '▾' : '▸';
  });
  wrap.append(header, content);
  return { wrap, content };
}

/** One built spawn button with its display label (kept so the goods filter can show/hide it by name). */
interface SpawnButton {
  readonly button: HTMLButtonElement;
  readonly label: string;
}

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
  const spawnButtons: { readonly button: HTMLButtonElement; readonly armed: Armed }[] = [];
  const swatchButtons: { readonly button: HTMLButtonElement; readonly player: number }[] = [];
  const status = el('div', FOOTER_STYLE);

  const sameArmed = (a: Armed, b: Armed | null): boolean => {
    if (b === null) return false;
    if (a.kind === 'unit' && b.kind === 'unit') return a.preset.id === b.preset.id;
    if (a.kind === 'resource' && b.kind === 'resource') return a.good === b.good;
    if (a.kind === 'good' && b.kind === 'good') return a.good === b.good;
    return false;
  };

  const armedLabel = (): string => {
    if (armed === null) return 'Nic nie wybrano — kliknij jednostkę / surowiec / towar powyżej.';
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
    const who = PLAYER_SWATCHES.find((s) => s.player === player);
    return `Uzbrojono: ${armed.preset.label} (gracz ${player} — ${who?.name ?? '?'}) — klikaj na mapie (PPM/Esc = anuluj).`;
  };

  const refresh = (): void => {
    for (const { button, armed: a } of spawnButtons) setButtonActive(button, sameArmed(a, armed));
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

  // ---- DOM: right-docked flex column (header · scrolling body · status footer) ----
  const panel = el('div', ADMIN_PANEL_STYLE);
  panel.style.display = 'none';

  const toggle = el('button', TOGGLE_STYLE, '🛠 Admin / Debug');
  let open = false;
  toggle.addEventListener('click', () => {
    open = !open;
    panel.style.display = open ? 'flex' : 'none';
    if (!open) setArmed(null); // hiding the panel disarms (a stray crosshair click is confusing)
    if (open) refreshNeedsButton(); // re-read the live rule — the boot value may predate a scene's toggle
  });

  // --- static header: title + spawn "stamp" settings (owner / HP / armor / needs) ---
  const header = el('div', HEADER_STYLE);
  header.append(el('div', 'font-weight:700;font-size:13px;margin-bottom:2px', 'Panel Admina / Debug'));
  header.append(
    el(
      'div',
      'opacity:0.7;font-size:11px;margin-bottom:8px',
      'Wybierz jednostkę / złoże / towar, potem klikaj na mapie. Zmieniaj gracza między klikami, by ustawić obie strony.',
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

  // --- scrolling body: collapsible palette sections ---
  const body = el('div', BODY_STYLE);

  // Wojownicy (open by default — the first thing a "spawn a fight" session reaches for).
  const warriors = collapsibleSection('Wojownicy', WARRIOR_PRESETS.length, true);
  warriors.content.append(
    rowOf(
      spawnEntries(
        WARRIOR_PRESETS.map((preset) => ({ label: preset.label, armed: { kind: 'unit', preset } })),
      ),
    ),
  );
  body.append(warriors.wrap);

  const civilians = collapsibleSection('Cywile', CIVILIAN_PRESETS.length, false);
  civilians.content.append(
    rowOf(
      spawnEntries(
        CIVILIAN_PRESETS.map((preset) => ({ label: preset.label, armed: { kind: 'unit', preset } })),
      ),
    ),
  );
  body.append(civilians.wrap);

  const resources = collapsibleSection('Złoża (do wydobycia)', RESOURCE_ENTRIES.length, false);
  resources.content.append(
    rowOf(
      spawnEntries(
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
  const goodButtons = spawnEntries(
    GOODS_ENTRIES.map((g) => ({
      label: goodLabelOf(g.good, g.label),
      armed: { kind: 'good', good: g.good },
    })),
  );
  goods.content.append(goodsFilter(goodButtons), rowOf(goodButtons));
  body.append(goods.wrap);

  panel.append(header, body, status);
  document.body.append(toggle, panel);
  refresh();

  /** Build one arm/disarm button per entry (registering each for the armed-highlight refresh). */
  function spawnEntries(
    entries: readonly { readonly label: string; readonly armed: Armed }[],
  ): readonly SpawnButton[] {
    return entries.map(({ label, armed: choice }) => {
      const button = el('button', BUTTON_STYLE, label);
      button.addEventListener('click', () => setArmed(sameArmed(choice, armed) ? null : choice));
      spawnButtons.push({ button, armed: choice });
      return { button, label };
    });
  }

  // ---- spawn on map click --------------------------------------------------
  const spawnAt = (col: number, row: number): void => {
    if (armed === null) return;
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

  // A WINDOW-CAPTURE mousedown runs BEFORE the canvas's RTS-control listeners (capture phase precedes
  // the target phase), so when armed it can consume the press and spawn instead of selecting. When not
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
    // when it lands off the map (no spawn there, but no stray "click empty ground = clear selection").
    const tile = deps.clientToTile(e.clientX, e.clientY);
    if (tile !== null) spawnAt(tile.col, tile.row);
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

/** Wrap already-built spawn buttons in a flex-wrap row. */
function rowOf(entries: readonly SpawnButton[]): HTMLElement {
  const row = el('div', ROW_STYLE);
  for (const { button } of entries) row.append(button);
  return row;
}

/** A case-insensitive name filter that shows/hides the goods buttons in place (a `type=search` input). */
function goodsFilter(entries: readonly SpawnButton[]): HTMLElement {
  const input = el(
    'input',
    'width:100%;box-sizing:border-box;margin-bottom:6px;background:#2a2118;color:#e8dcc8;border:1px solid #6b5840;border-radius:4px;padding:3px 6px;font:12px ui-monospace,monospace',
  );
  input.type = 'search';
  input.placeholder = 'Filtruj towary…';
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    for (const { button, label } of entries)
      button.style.display = q === '' || label.toLowerCase().includes(q) ? '' : 'none';
  });
  return input;
}

/** A small "label: [number input]" field that reports parsed changes (blank/NaN → 0). */
function numberField(label: string, value: number, onChange: (v: number) => void): HTMLElement {
  const wrap = el('label', 'display:flex;gap:5px;align-items:center');
  wrap.append(el('span', 'opacity:0.8', label));
  const input = el(
    'input',
    'width:64px;background:#2a2118;color:#e8dcc8;border:1px solid #6b5840;border-radius:4px;padding:2px 4px;font:12px ui-monospace,monospace',
  );
  input.type = 'number';
  input.min = '0';
  input.value = String(value);
  // Commit on `input` (every keystroke), NOT `change` (blur): a spawn press `preventDefault()`s the
  // click, which suppresses the field's blur, so a `change`-committed value would never reach a click.
  input.addEventListener('input', () => {
    const v = Number.parseInt(input.value, 10);
    onChange(Number.isFinite(v) && v > 0 ? v : 0);
  });
  wrap.append(input);
  return wrap;
}

/** A small "label: [select]" field over integer-valued options. */
function selectField(
  label: string,
  options: readonly { value: number; label: string }[],
  value: number,
  onChange: (v: number) => void,
): HTMLElement {
  const wrap = el('label', 'display:flex;gap:5px;align-items:center');
  wrap.append(el('span', 'opacity:0.8', label));
  const select = el(
    'select',
    'background:#2a2118;color:#e8dcc8;border:1px solid #6b5840;border-radius:4px;padding:2px 4px;font:12px ui-monospace,monospace',
  );
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = String(o.value);
    opt.textContent = o.label;
    if (o.value === value) opt.selected = true;
    select.append(opt);
  }
  select.addEventListener('change', () => onChange(Number.parseInt(select.value, 10) || 0));
  wrap.append(select);
  return wrap;
}
