import type { ContentSet } from '@vinland/data';
import { ONE, TICKS_PER_SECOND, type WorldSnapshot, systems } from '@vinland/sim';
import { BUTTON_STYLE, el } from './overlay.js';
import { entityById, isBuilding, isSettler, num, ownerPlayerOf } from './snapshot.js';

/** The four military stances (`MILITARY_MODE`), with Polish labels — used to name the live "Postawa" line
 *  (the stance BUTTONS live in the action ring; see `view/settler-actions.ts`). */
const STANCES: ReadonlyArray<{ mode: number; label: string }> = [
  { mode: systems.MILITARY_MODE.ATTACK, label: 'Atak' },
  { mode: systems.MILITARY_MODE.DEFEND, label: 'Obrona' },
  { mode: systems.MILITARY_MODE.IGNORE, label: 'Ignoruj' },
  { mode: systems.MILITARY_MODE.FLEE, label: 'Ucieczka' },
];

/** A stance mode id → its Polish label (for the info card's live "Postawa" line). */
function stanceLabel(mode: number | undefined): string {
  return STANCES.find((s) => s.mode === mode)?.label ?? '—';
}

/**
 * The always-on SELECTED-UNIT **info** card — the settler/building state the human reads (the original's
 * bottom-right details window, roughly). It reads the frozen snapshot (never live sim state) and issues its
 * one action (a building `demolish`) back through the command seam, so it stays on the app's one-way flow.
 * Pure DOM + floats (app-layer only).
 *
 * It is pinned bottom-RIGHT and shown the moment anything is selected — no keypress to see a unit's state.
 * The contextual ACTION buttons (the original-art default menu; "change profession" is the wired one) are a
 * separate menu — Space or a right-click on the unit — anchored on the unit itself
 * ({@link import('./settler-actions.js')}); this card is data only.
 *
 * Update discipline: the STRUCTURE (labels, the demolish button) is rebuilt only when the selection changes
 * ({@link render}), and the live VALUES (need bars, carry, order status) are mutated in place each frame
 * ({@link tick}) — the scene-overlay's build-once-update-text pattern.
 */

/** A selectable profession the action ring offers — the job's typeId + a human label. Shared with the ring. */
export interface Profession {
  readonly jobType: number;
  readonly label: string;
}

/**
 * The professions offered as one-click job changes, derived from a content set's jobs — every job except
 * idle (typeId 0), labelled by its content id. The single source both the live/scene entries and the action
 * ring build their profession list from, so the "which jobs are offered" rule lives in one place.
 */
export function professionsFromContent(content: ContentSet): Profession[] {
  return content.jobs.filter((j) => j.typeId !== 0).map((j) => ({ jobType: j.typeId, label: j.id }));
}

export interface UnitPanelOptions {
  /** The professions offered — used here only to LABEL a settler's current job (the buttons are the ring's). */
  readonly professions: readonly Profession[];
  readonly onDemolish: (entityId: number) => void;
}

export interface UnitPanel {
  /** Rebuild the info card for a new selection (called on every selection change). */
  render(snapshot: WorldSnapshot, selected: ReadonlySet<number>): void;
  /** Refresh the info card's live values in place for the current selection (called each frame). */
  tick(snapshot: WorldSnapshot): void;
  dispose(): void;
}

/** Panel chrome. */
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

const NEEDS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'hunger', label: 'Głód' },
  { key: 'fatigue', label: 'Zmęczenie' },
  { key: 'piety', label: 'Pobożność' },
  { key: 'enjoyment', label: 'Radość' },
];

/** The untyped component bag of one snapshot entity — the display reads fields defensively via `num`. */
interface Comp {
  readonly [k: string]: unknown;
}
function pct(fixed: number | undefined): number {
  return fixed === undefined ? 0 : Math.max(0, Math.min(100, Math.round((fixed / ONE) * 100)));
}

/** Mount the info card (hidden until something is selected). */
export function mountUnitPanel(opts: UnitPanelOptions): UnitPanel {
  const info = el('div', INFO_STYLE);
  info.style.display = 'none';
  document.body.append(info);

  // Value nodes refreshed by tick(), keyed by a stable name; rebuilt by render() each selection change.
  let dynamic: Map<string, HTMLElement> = new Map();
  let liveSettlerId: number | null = null; // the single settler whose live bars tick() refreshes

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

  /** A settler's current job → its Polish label (kept live so a menu profession-change shows on the card). */
  function jobLabelOf(jobType: number | undefined): string {
    return (
      opts.professions.find((p) => p.jobType === jobType)?.label ??
      (jobType === undefined || jobType === null ? 'bezrobotny' : `zawód ${jobType}`)
    );
  }

  function renderSettler(snapshot: WorldSnapshot, id: number): void {
    liveSettlerId = id;
    const ent = entityById(snapshot, id);
    const s = (ent?.components.Settler ?? {}) as Comp;
    // The title is dynamic: `tick` refreshes it, so changing this unit's profession via the action menu
    // updates the card in place (no re-selection needed).
    const title = el(
      'div',
      'font-weight:700;font-size:14px;margin-bottom:6px',
      `Wiking — ${jobLabelOf(num(s.jobType))}`,
    );
    dynamic.set('title', title);
    info.append(title);
    info.append(infoRow('Gracz', `#${(ent !== undefined ? ownerPlayerOf(ent) : undefined) ?? '—'}`));
    info.append(infoRow('Plemię', `${num(s.tribe) ?? '—'}`));
    for (const n of NEEDS) info.append(needBar(n.label, n.key));
    info.append(infoRow('Niesie', '—', 'carry'));
    info.append(infoRow('Postawa', '—', 'stance'));
    info.append(infoRow('Status', '—', 'status'));
    info.append(el('div', 'opacity:0.6;font-size:11px;margin-top:6px', 'Spacja — akcje jednostki'));
  }

  function renderBuilding(snapshot: WorldSnapshot, id: number): void {
    liveSettlerId = null;
    const ent = entityById(snapshot, id);
    const b = (ent?.components.Building ?? {}) as Comp;
    info.append(
      el(
        'div',
        'font-weight:700;font-size:14px;margin-bottom:6px',
        `Budynek — typ ${num(b.buildingType) ?? '?'}`,
      ),
    );
    info.append(infoRow('Gracz', `#${(ent !== undefined ? ownerPlayerOf(ent) : undefined) ?? '—'}`));
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

  /** Rebuild the info card for a new selection; show/hide it by whether anything is selected. */
  function render(snapshot: WorldSnapshot, selected: ReadonlySet<number>): void {
    info.replaceChildren();
    dynamic = new Map();
    liveSettlerId = null;

    const ids = [...selected];
    const byId = (id: number): ReturnType<typeof entityById> => entityById(snapshot, id);
    const settlerIds = ids.filter((id) => {
      const e = byId(id);
      return e !== undefined && isSettler(e);
    });
    const buildingIds = ids.filter((id) => {
      const e = byId(id);
      return e !== undefined && isBuilding(e);
    });

    if (ids.length === 0) {
      info.style.display = 'none';
      return;
    }
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
      info.append(el('div', 'opacity:0.75', 'Kliknij prawym, aby wysłać. Spacja — akcje jednostek.'));
    } else {
      info.append(el('div', 'opacity:0.75', `${ids.length} zaznaczonych`));
    }

    tick(snapshot);
  }

  function tick(snapshot: WorldSnapshot): void {
    if (liveSettlerId === null) return;
    const ent = entityById(snapshot, liveSettlerId);
    if (ent === undefined) return;
    const s = (ent.components.Settler ?? {}) as Comp;
    const titleEl = dynamic.get('title');
    if (titleEl !== undefined) titleEl.textContent = `Wiking — ${jobLabelOf(num(s.jobType))}`;
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
    const stanceEl = dynamic.get('stance');
    if (stanceEl !== undefined) {
      const stance = ent.components.Stance as { mode?: unknown } | undefined;
      stanceEl.textContent = stanceLabel(num(stance?.mode));
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
    dispose: () => {
      info.remove();
    },
  };
}
