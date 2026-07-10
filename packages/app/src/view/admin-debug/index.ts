import type { Command } from '@vinland/sim';
import { HUMAN_PLAYER } from '../../game/rules.js';
import { resourceCommand } from '../../game/sandbox/place.js';
import { BUTTON_STYLE, el } from '../overlay.js';
import {
  ARMOR_CLASSES,
  CIVILIAN_PRESETS,
  GOODS_ENTRIES,
  PLAYER_SWATCHES,
  RESOURCE_ENTRIES,
  type UnitPreset,
  WARRIOR_PRESETS,
  goodDropCommand,
  unitSpawnCommand,
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
}

/** What the next map click will place. */
type Armed =
  | { readonly kind: 'unit'; readonly preset: UnitPreset }
  | { readonly kind: 'resource'; readonly good: number }
  | { readonly kind: 'good'; readonly good: number };

/** A combatant's default hitpoint pool (sandbox scale — a human's real HP is unreadable, an
 *  approximation like the combat scene's; source basis "Combat hit resolution"). */
const DEFAULT_HITPOINTS = 300;

const TOGGLE_STYLE = [
  'position:fixed',
  'top:8px',
  'left:50%',
  'transform:translateX(-50%)',
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

const ADMIN_PANEL_STYLE = [
  'position:fixed',
  'top:44px',
  'left:50%',
  'transform:translateX(-50%)',
  'width:360px',
  'max-height:calc(100vh - 60px)',
  'overflow-y:auto',
  'box-sizing:border-box',
  'padding:10px 12px',
  'background:rgba(20,16,12,0.95)',
  'color:#e8dcc8',
  'font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace',
  'border:1px solid #6b5840',
  'border-radius:8px',
  'box-shadow:0 6px 24px rgba(0,0,0,0.5)',
  'z-index:150',
].join(';');

const SECTION_TITLE_STYLE =
  'font-weight:700;font-size:10px;letter-spacing:0.07em;text-transform:uppercase;opacity:0.6;margin:12px 0 4px';
const ROW_STYLE = 'display:flex;flex-wrap:wrap;gap:4px';

/** The armed-button highlight (brighter than the resting `BUTTON_STYLE`). */
function setButtonActive(button: HTMLButtonElement, active: boolean): void {
  button.style.background = active ? '#6b5840' : '#3a2f22';
  button.style.fontWeight = active ? '700' : '400';
  button.style.outline = active ? '1px solid #d8ccb0' : 'none';
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
  const status = el('div', 'margin-top:10px;padding-top:8px;border-top:1px solid #5a4a36;min-height:16px');

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

  // ---- DOM -----------------------------------------------------------------
  const panel = el('div', ADMIN_PANEL_STYLE);
  panel.style.display = 'none';

  const toggle = el('button', TOGGLE_STYLE, '🛠 Admin / Debug');
  let open = false;
  toggle.addEventListener('click', () => {
    open = !open;
    panel.style.display = open ? 'block' : 'none';
    if (!open) setArmed(null); // hiding the panel disarms (a stray crosshair click is confusing)
  });

  panel.append(el('div', 'font-weight:700;font-size:13px;margin-bottom:2px', 'Panel Admina / Debug'));
  panel.append(
    el(
      'div',
      'opacity:0.7;font-size:11px',
      'Wybierz jednostkę / złoże / towar, potem klikaj na mapie. Zmieniaj gracza między klikami, by ustawić obie strony.',
    ),
  );

  // Player swatches.
  panel.append(el('div', SECTION_TITLE_STYLE, 'Gracz (właściciel)'));
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
  panel.append(swatchRow);

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
  panel.append(statsRow);

  // Unit + resource palettes — each an armable button row (a click arms/disarms that choice).
  panel.append(el('div', SECTION_TITLE_STYLE, 'Wojownicy'));
  panel.append(
    spawnRow(WARRIOR_PRESETS.map((preset) => ({ label: preset.label, armed: { kind: 'unit', preset } }))),
  );
  panel.append(el('div', SECTION_TITLE_STYLE, 'Cywile'));
  panel.append(
    spawnRow(CIVILIAN_PRESETS.map((preset) => ({ label: preset.label, armed: { kind: 'unit', preset } }))),
  );
  panel.append(el('div', SECTION_TITLE_STYLE, 'Złoża (do wydobycia)'));
  panel.append(
    spawnRow(
      RESOURCE_ENTRIES.map((r) => ({
        label: goodLabelOf(r.good, r.label),
        armed: { kind: 'resource', good: r.good },
      })),
    ),
  );
  // Every good in the catalog, dropped as a loose ground pile (the `dropGood` command) — the admin "spawn
  // any good" list the in-game goods tool mirrors.
  panel.append(el('div', SECTION_TITLE_STYLE, 'Towary (stos na ziemi)'));
  panel.append(
    spawnRow(
      GOODS_ENTRIES.map((g) => ({
        label: goodLabelOf(g.good, g.label),
        armed: { kind: 'good', good: g.good },
      })),
    ),
  );

  panel.append(status);
  document.body.append(toggle, panel);
  refresh();

  /** A row of arm/disarm buttons — one per spawnable entry, each toggling its `Armed` choice. */
  function spawnRow(entries: readonly { readonly label: string; readonly armed: Armed }[]): HTMLElement {
    const row = el('div', ROW_STYLE);
    for (const { label, armed: choice } of entries) {
      const b = el('button', BUTTON_STYLE, label);
      b.addEventListener('click', () => setArmed(sameArmed(choice, armed) ? null : choice));
      spawnButtons.push({ button: b, armed: choice });
      row.append(b);
    }
    return row;
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
