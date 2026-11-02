import type { UiCue } from '@open-northland/audio';
import { type RememberedMarkers, tileToScreenX, tileToScreenY } from '@open-northland/render';
import type { FogView, WorldSnapshot } from '@open-northland/sim';
import { messages } from '../../i18n/index.js';
import type { NationEmblemPainter } from '../dom/diplomacy-window/emblems.js';
import { GLYPH } from '../dom/icons.js';
import { button, element, setHidden, setStyleVar, write } from '../dom/parts/dom.js';
import { contains } from '../geometry.js';
import type { MinimapHandle } from '../minimap/index.js';
import { visibleMinimapRect, worldToMinimap } from '../minimap/model.js';
import { createNationPlaque, type DiplomacyMapNation, type NationPlaque } from './labels.js';
import { knownBuildings, type LabelBox, peopleOf, settlementsOf, spreadLabels } from './places.js';
import './diplomacy-map.css';

/** Wall-clock ms between two reads of who stands where: a village changes slowly, so an open map walks
 *  the buildings about once a second and a shut one never does. */
const READ_INTERVAL_MS = 1000;
/** Design px between a settlement's pin and the plaque above it. */
const PIN_CLEARANCE = 8;

export interface DiplomacyMapDeps {
  readonly minimap: Pick<
    MinimapHandle,
    'setOverview' | 'placement' | 'focusOverviewButton' | 'overviewHost' | 'overviewCanvas'
  >;
  readonly nations: () => readonly DiplomacyMapNation[];
  readonly snapshot: () => WorldSnapshot;
  /** The viewer's fog, null with fog off or the whole map in view. */
  readonly fog: () => FogView | null;
  readonly memory: RememberedMarkers | undefined;
  readonly paintEmblem: NationEmblemPainter;
  readonly uiScale: () => number;
  /** True while the map must not stand: the HUD is hidden. */
  readonly unavailable: () => boolean;
  /** A plaque was pressed: open that nation's diplomacy page. */
  readonly onNation: (player: number) => void;
  readonly cue: (cue: UiCue) => void;
  /** Wall-clock ms. */
  readonly now: () => number;
}

export interface DiplomacyMap {
  isOpen(): boolean;
  /** False when the map may not stand now. */
  open(): boolean;
  close(): void;
  toggle(): void;
  /** Once a frame: follow the map's pan and zoom, and read who stands where when due. */
  refresh(): void;
  dispose(): void;
}

/** One labelled settlement, in tile coordinates. */
interface PlacedSettlement {
  readonly plaque: NationPlaque;
  readonly pin: HTMLElement;
  col: number;
  row: number;
}

/** The overview, each known settlement labelled with its nation and the stances between it and the
 *  viewer. Nothing here runs while the map is shut. */
export function createDiplomacyMap(deps: DiplomacyMapDeps): DiplomacyMap {
  const copy = messages().hud.diplomacyMap;
  const root = element('div', 'on-dipmap');
  root.hidden = true;
  const field = element('div', 'on-dipmap__field');
  const head = element('div', 'on-dipmap__head');
  const title = element('h2', 'on-dipmap__title');
  write(title, copy.title);
  // On the title, as the frame's corners go under the HUD columns.
  const closeButton = button('on-medallion on-window__close on-dipmap__close', GLYPH.close);
  closeButton.setAttribute('aria-label', messages().hud.shell.close);
  head.append(title, closeButton);
  const unknown = element('div', 'on-dipmap__unknown');
  const unknownLabel = element('span', 'on-dipmap__unknown-label');
  write(unknownLabel, copy.unknown);
  unknown.append(unknownLabel);
  root.append(field, head, unknown);
  deps.minimap.overviewHost.append(root);

  let opened = false;
  let readAt = Number.NEGATIVE_INFINITY;
  let placedLayout: unknown = null;
  const settlements = new Map<string, PlacedSettlement>();
  const unknownPlaques = new Map<number, NationPlaque>();

  const pressNation = (player: number): void => {
    deps.cue('confirm');
    deps.onNation(player);
  };

  /** Who stands where as the viewer knows it, plaques made and dropped to match. */
  function read(): void {
    const nations = deps.nations();
    const byPlayer = new Map(nations.map((nation) => [nation.player, nation]));
    const counts = new Map<number, number>();
    const kept = new Set<string>();
    const snapshot = deps.snapshot();
    const known = knownBuildings(snapshot, deps.fog(), deps.memory);
    const own = nations.find((nation) => nation.own);
    if (own !== undefined && !known.some((spot) => spot.owner === own.player))
      known.push(...peopleOf(snapshot, own.player));
    for (const settlement of settlementsOf(known)) {
      const nation = byPlayer.get(settlement.owner);
      if (nation === undefined) continue;
      const index = counts.get(nation.player) ?? 0;
      counts.set(nation.player, index + 1);
      const key = `${nation.player}:${index}`;
      let placed = settlements.get(key);
      if (placed === undefined) {
        placed = {
          plaque: createNationPlaque('on-dipmap-plaque--map', deps.paintEmblem, pressNation),
          pin: element('span', 'on-dipmap__pin'),
          col: 0,
          row: 0,
        };
        settlements.set(key, placed);
        field.append(placed.pin, placed.plaque.element);
      }
      placed.col = settlement.col;
      placed.row = settlement.row;
      placed.plaque.update(nation, own);
      setStyleVar(placed.pin, '--nation-colour', `#${nation.colour.toString(16).padStart(6, '0')}`);
      kept.add(key);
    }
    for (const [key, placed] of settlements) {
      if (kept.has(key)) continue;
      placed.plaque.element.remove();
      placed.pin.remove();
      settlements.delete(key);
    }
    const missing = nations.filter((nation) => !nation.own && !counts.has(nation.player));
    for (const [player, plaque] of unknownPlaques) {
      if (missing.some((nation) => nation.player === player)) continue;
      plaque.element.remove();
      unknownPlaques.delete(player);
    }
    for (const nation of missing) {
      let plaque = unknownPlaques.get(nation.player);
      if (plaque === undefined) {
        plaque = createNationPlaque('on-dipmap-plaque--strip', deps.paintEmblem, pressNation);
        unknownPlaques.set(nation.player, plaque);
        unknown.append(plaque.element);
      }
      plaque.update(nation, own);
    }
    setHidden(unknown, missing.length === 0);
  }

  /** Stand the plaques over their settlements at the map's present pan and zoom. */
  function place(): void {
    const { layout, bounds } = deps.minimap.placement();
    placedLayout = layout;
    const scale = deps.uiScale();
    const { inner } = layout;
    Object.assign(field.style, {
      left: `${(inner.x - layout.panel.x) / scale}px`,
      top: `${(inner.y - layout.panel.y) / scale}px`,
      width: `${inner.w / scale}px`,
      height: `${inner.h / scale}px`,
    });
    const shown = visibleMinimapRect(layout);
    const boxes: LabelBox[] = [];
    for (const [key, placed] of settlements) {
      const at = worldToMinimap(
        layout,
        bounds,
        tileToScreenX(placed.col, placed.row),
        tileToScreenY(placed.row),
      );
      const inView = contains(shown, at.x, at.y);
      const { element: plaque } = placed.plaque;
      setHidden(plaque, !inView);
      setHidden(placed.pin, !inView);
      if (!inView) continue;
      const x = (at.x - inner.x) / scale;
      const y = (at.y - inner.y) / scale;
      placed.pin.style.left = `${x}px`;
      placed.pin.style.top = `${y}px`;
      const w = plaque.offsetWidth;
      const h = plaque.offsetHeight;
      boxes.push({ key, x: x - w / 2, y: y - h - PIN_CLEARANCE, w, h });
    }
    const area = { x: 0, y: 0, w: inner.w / scale, h: inner.h / scale };
    for (const spot of spreadLabels(boxes, area)) {
      const plaque = settlements.get(spot.key)?.plaque.element;
      if (plaque !== undefined) plaque.style.transform = `translate(${spot.x}px, ${spot.y}px)`;
    }
  }

  // A plaque sits on the map, so a wheel or a press it does not take is the map's beneath it.
  const forwardWheel = (event: WheelEvent): void => {
    event.preventDefault();
    deps.minimap.overviewCanvas.dispatchEvent(new WheelEvent('wheel', event));
  };
  const forwardPress = (event: MouseEvent): void => {
    if (event.button !== 0) deps.minimap.overviewCanvas.dispatchEvent(new MouseEvent('mousedown', event));
  };
  field.addEventListener('wheel', forwardWheel, { passive: false });
  field.addEventListener('mousedown', forwardPress);

  function close(): void {
    if (!opened) return;
    opened = false;
    const heldFocus = root.contains(document.activeElement);
    root.hidden = true;
    deps.minimap.setOverview(false);
    if (heldFocus) deps.minimap.focusOverviewButton();
  }
  function open(): boolean {
    if (opened) return true;
    if (deps.unavailable()) return false;
    opened = true;
    deps.minimap.setOverview(true);
    root.hidden = false;
    read();
    readAt = deps.now();
    place();
    return true;
  }
  closeButton.addEventListener('click', () => {
    deps.cue('confirm');
    close();
  });

  return {
    isOpen: () => opened,
    open,
    close,
    toggle: () => {
      if (opened) {
        deps.cue('confirm');
        close();
      } else deps.cue(open() ? 'confirm' : 'fail');
    },
    refresh: () => {
      if (!opened) return;
      if (deps.unavailable()) {
        close();
        return;
      }
      const now = deps.now();
      const due = now - readAt >= READ_INTERVAL_MS;
      if (due) {
        read();
        readAt = now;
      }
      if (due || deps.minimap.placement().layout !== placedLayout) place();
    },
    dispose: () => {
      close();
      field.removeEventListener('wheel', forwardWheel);
      field.removeEventListener('mousedown', forwardPress);
      root.remove();
    },
  };
}
