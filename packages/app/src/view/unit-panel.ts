import type { ContentSet } from '@vinland/data';
import { ONE, TICKS_PER_SECOND, type WorldSnapshot } from '@vinland/sim';
import { BUTTON_STYLE, el } from './overlay.js';

/**
 * The SELECTED-UNIT panels — the settler/building info card the human reads (the original's settler UI,
 * roughly). It reads the frozen snapshot (never live sim state) and issues its profession-change /
 * demolish actions back through the command seam (`onSetJob`/`onDemolish`), so it stays on the app's
 * one-way flow. Pure DOM + floats (app-layer only).
 *
 * TWO panels, split by how the human wants them (per the RTS feel request):
 *  - the **INFO** card (needs/hunger, player, tribe, carry, status; or a building's data + demolish) is
 *    ALWAYS shown, pinned bottom-RIGHT, the moment anything is selected — no keypress to see a unit's state;
 *  - the **ACTIONS** card (the profession-change buttons) is toggled with **Space**, pinned bottom-centre,
 *    so the extra controls only appear when the human asks for them.
 *
 * Update discipline: the STRUCTURE (labels, buttons) is rebuilt only when the selection changes
 * ({@link render}), and the live VALUES (need bars, carry, order status) are mutated in place each frame
 * ({@link tick}). Rebuilding every frame would drop a half-finished click on a profession button — the
 * scene-overlay's build-once-update-text pattern avoids exactly that.
 */

/** A selectable profession offered by the actions panel's buttons — the job's typeId + a human label. */
export interface Profession {
  readonly jobType: number;
  readonly label: string;
}

/**
 * The professions the panel offers as one-click job changes, derived from a content set's jobs — every
 * job except idle (typeId 0), labelled by its content id. The single source both the live entry and the
 * scene entry build their profession list from, so the "which jobs are offered" rule lives in one place.
 */
export function professionsFromContent(content: ContentSet): Profession[] {
  return content.jobs.filter((j) => j.typeId !== 0).map((j) => ({ jobType: j.typeId, label: j.id }));
}

export interface UnitPanelOptions {
  readonly professions: readonly Profession[];
  /** Human player id — the panel only ever shows/acts on this player's units (the controller pre-filters). */
  readonly onSetJob: (entityIds: readonly number[], jobType: number) => void;
  readonly onDemolish: (entityId: number) => void;
}

export interface UnitPanel {
  /** Rebuild both panels' bodies for a new selection (called on every selection change). */
  render(snapshot: WorldSnapshot, selected: ReadonlySet<number>): void;
  /** Refresh the info panel's live values in place for the current selection (called each frame). */
  tick(snapshot: WorldSnapshot): void;
  /** Toggle the Space-driven ACTIONS (profession) panel; the info panel is unaffected (always-on). */
  toggleActions(): void;
  isActionsOpen(): boolean;
  dispose(): void;
}

/** Shared chrome for both cards; each adds its own corner anchor. */
const PANEL_BASE = [
  'position:fixed',
  'box-sizing:border-box',
  'padding:10px 14px',
  'background:rgba(20,16,12,0.94)',
  'color:#e8dcc8',
  'font:13px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace',
  'border:1px solid #5a4a36',
  'border-radius:8px',
  'box-shadow:0 6px 24px rgba(0,0,0,0.5)',
  'z-index:60',
];
/** The always-on INFO card: bottom-RIGHT (clear of the top-left HUD + the bottom-left perf overlay). */
const INFO_STYLE = [...PANEL_BASE, 'right:12px', 'bottom:12px', 'min-width:230px', 'max-width:320px'].join(
  ';',
);
/** The Space-toggled ACTIONS card: bottom-CENTRE. */
const ACTIONS_STYLE = [
  ...PANEL_BASE,
  'left:50%',
  'bottom:12px',
  'transform:translateX(-50%)',
  'min-width:280px',
  'max-width:440px',
].join(';');

const NEEDS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'hunger', label: 'Głód' },
  { key: 'fatigue', label: 'Zmęczenie' },
  { key: 'piety', label: 'Pobożność' },
  { key: 'enjoyment', label: 'Radość' },
];

interface Comp {
  readonly [k: string]: unknown;
}
function entity(snapshot: WorldSnapshot, id: number): { components: Comp } | undefined {
  return snapshot.entities.find((e) => e.id === id);
}
function num(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}
function pct(fixed: number | undefined): number {
  return fixed === undefined ? 0 : Math.max(0, Math.min(100, Math.round((fixed / ONE) * 100)));
}

/** Mount both panels (hidden until something is selected / Space is pressed). */
export function mountUnitPanel(opts: UnitPanelOptions): UnitPanel {
  const info = el('div', INFO_STYLE);
  const actions = el('div', ACTIONS_STYLE);
  info.style.display = 'none';
  actions.style.display = 'none';
  document.body.append(info, actions);

  let actionsOpen = false;
  // Value nodes refreshed by tick(), keyed by a stable name; rebuilt by render() each selection change.
  let dynamic: Map<string, HTMLElement> = new Map();
  let liveSettlerId: number | null = null; // the single settler whose live bars tick() refreshes

  const professionRow = (ids: readonly number[]): HTMLElement => {
    const row = el('div', 'display:flex;flex-wrap:wrap;gap:4px');
    row.append(el('div', 'width:100%;opacity:0.7;font-size:12px', 'Zmień zawód:'));
    for (const p of opts.professions) {
      const b = el('button', BUTTON_STYLE, p.label);
      b.addEventListener('click', () => opts.onSetJob(ids, p.jobType));
      row.append(b);
    }
    return row;
  };

  const needBar = (label: string, key: string): HTMLElement => {
    const wrap = el('div', 'display:flex;align-items:center;gap:6px;margin-top:2px');
    wrap.append(el('div', 'width:80px;opacity:0.8', label));
    const track = el('div', 'flex:1;height:8px;background:#2a2119;border-radius:4px;overflow:hidden');
    const fill = el('div', 'height:100%;width:0%;background:#b8894a');
    dynamic.set(`need:${key}`, fill);
    track.append(fill);
    wrap.append(track);
    return wrap;
  };

  const infoRow = (label: string, value: string, dynKey?: string): HTMLElement => {
    const row = el('div', 'display:flex;gap:6px');
    row.append(el('div', 'width:80px;opacity:0.7', label));
    const val = el('div', 'flex:1', value);
    if (dynKey !== undefined) dynamic.set(dynKey, val);
    row.append(val);
    return row;
  };

  function renderSettler(snapshot: WorldSnapshot, id: number): void {
    liveSettlerId = id;
    const ent = entity(snapshot, id);
    const s = (ent?.components.Settler ?? {}) as Comp;
    const owner = (ent?.components.Owner ?? {}) as Comp;
    const jobType = num(s.jobType);
    const jobLabel =
      opts.professions.find((p) => p.jobType === jobType)?.label ??
      (jobType === undefined || jobType === null ? 'bezrobotny' : `zawód ${jobType}`);
    info.append(el('div', 'font-weight:700;font-size:14px;margin-bottom:6px', `Wiking — ${jobLabel}`));
    info.append(infoRow('Gracz', `#${num(owner.player) ?? '—'}`));
    info.append(infoRow('Plemię', `${num(s.tribe) ?? '—'}`));
    for (const n of NEEDS) info.append(needBar(n.label, n.key));
    info.append(infoRow('Niesie', '—', 'carry'));
    info.append(infoRow('Status', '—', 'status'));
  }

  function renderBuilding(snapshot: WorldSnapshot, id: number): void {
    liveSettlerId = null;
    const ent = entity(snapshot, id);
    const b = (ent?.components.Building ?? {}) as Comp;
    const owner = (ent?.components.Owner ?? {}) as Comp;
    info.append(
      el(
        'div',
        'font-weight:700;font-size:14px;margin-bottom:6px',
        `Budynek — typ ${num(b.buildingType) ?? '?'}`,
      ),
    );
    info.append(infoRow('Gracz', `#${num(owner.player) ?? '—'}`));
    info.append(infoRow('Plemię', `${num(b.tribe) ?? '—'}`));
    info.append(infoRow('Poziom', `${num(b.level) ?? 0}`));
    info.append(infoRow('Budowa', `${pct(num(b.built))}%`, 'built'));
    info.append(infoRow('Magazyn', stockText(ent?.components.Stockpile), 'stock'));
    const bar = el('div', 'margin-top:8px');
    const demolish = el('button', BUTTON_STYLE, 'Rozbierz');
    demolish.addEventListener('click', () => opts.onDemolish(id));
    bar.append(demolish);
    info.append(bar);
  }

  function stockText(stockpile: unknown): string {
    const amounts = (stockpile as { amounts?: unknown } | undefined)?.amounts;
    if (!Array.isArray(amounts) || amounts.length === 0) return 'pusty';
    return amounts.map((pair) => (Array.isArray(pair) ? `${pair[0]}:${pair[1]}` : '')).join('  ');
  }

  /** Rebuild both cards for a new selection; show/hide the info card by whether anything is selected. */
  function render(snapshot: WorldSnapshot, selected: ReadonlySet<number>): void {
    info.replaceChildren();
    actions.replaceChildren();
    dynamic = new Map();
    liveSettlerId = null;

    const ids = [...selected];
    const settlerIds = ids.filter((id) => entity(snapshot, id)?.components.Settler !== undefined);
    const buildingIds = ids.filter((id) => entity(snapshot, id)?.components.Building !== undefined);

    // INFO card (always-on): unit/building state.
    if (ids.length === 0) {
      info.style.display = 'none';
    } else {
      info.style.display = 'block';
      if (settlerIds.length === 0 && buildingIds.length === 1) {
        renderBuilding(snapshot, buildingIds[0] as number);
      } else if (settlerIds.length === 1) {
        renderSettler(snapshot, settlerIds[0] as number);
      } else if (settlerIds.length > 1) {
        info.append(
          el(
            'div',
            'font-weight:700;font-size:14px;margin-bottom:6px',
            `${settlerIds.length} zaznaczonych wikingów`,
          ),
        );
        info.append(el('div', 'opacity:0.75', 'Kliknij prawym, aby wysłać. Spacja — zmiana zawodu.'));
      } else {
        info.append(el('div', 'opacity:0.75', `${ids.length} zaznaczonych`));
      }
    }

    // ACTIONS card (Space): profession buttons for the selected settlers, if any.
    if (settlerIds.length > 0) {
      actions.append(professionRow(settlerIds));
    } else {
      actions.append(el('div', 'opacity:0.75', 'Brak akcji dla zaznaczenia.'));
    }
    actions.style.display = actionsOpen ? 'block' : 'none';

    tick(snapshot);
  }

  function tick(snapshot: WorldSnapshot): void {
    if (liveSettlerId === null) return;
    const ent = entity(snapshot, liveSettlerId);
    if (ent === undefined) return;
    const s = (ent.components.Settler ?? {}) as Comp;
    for (const n of NEEDS) {
      const fill = dynamic.get(`need:${n.key}`);
      if (fill !== undefined) fill.style.width = `${pct(num(s[n.key]))}%`;
    }
    const carry = ent.components.Carrying as { goodType?: unknown; amount?: unknown } | undefined;
    const carryEl = dynamic.get('carry');
    if (carryEl !== undefined) {
      carryEl.textContent =
        carry === undefined ? '—' : `dobro ${num(carry.goodType) ?? '?'} ×${num(carry.amount) ?? 0}`;
    }
    const statusEl = dynamic.get('status');
    if (statusEl !== undefined) statusEl.textContent = settlerStatus(ent.components, snapshot.tick);
  }

  function settlerStatus(components: Comp, tick: number): string {
    const order = components.PlayerOrder as { expiresAt?: unknown } | undefined;
    const moving = 'PathFollow' in components || 'MoveGoal' in components;
    if (order !== undefined) {
      if (moving) return 'idzie na rozkaz';
      const expires = num(order.expiresAt);
      return expires === undefined
        ? 'na pozycji'
        : `stoi (${Math.max(0, Math.ceil((expires - tick) / TICKS_PER_SECOND))}s)`;
    }
    if ('CurrentAtomic' in components) return 'pracuje';
    if (moving) return 'idzie';
    return 'bezczynny';
  }

  return {
    render,
    tick,
    toggleActions: () => {
      actionsOpen = !actionsOpen;
      actions.style.display = actionsOpen ? 'block' : 'none';
    },
    isActionsOpen: () => actionsOpen,
    dispose: () => {
      info.remove();
      actions.remove();
    },
  };
}
