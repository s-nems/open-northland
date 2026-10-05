import { MINIMAP_GROUND_MODES, type MinimapGroundMode } from '@open-northland/render/data';
import { formatMessage, messages } from '../../i18n/index.js';
import {
  button,
  element,
  isDisabled,
  setAttribute,
  setDisabled,
  setHidden,
  setTip,
  write,
} from '../dom/parts/dom.js';
import { attachTipLayer } from '../dom/parts/tip-layer.js';
import type { Rect } from '../geometry.js';
import { createMinimapBacking } from './backing.js';
import {
  allMinimapLayersShown,
  MINIMAP_COLOUR_MODES,
  MINIMAP_LAYERS,
  MINIMAP_MARKER_SIZES,
  MINIMAP_SCOPES,
  type MinimapColourMode,
  type MinimapFilters,
  type MinimapLayer,
  type MinimapMarkerSize,
  type MinimapScope,
} from './filters.js';
import type { MinimapFrame } from './frames.js';
import type { MinimapSize } from './model.js';
import './chrome.css';

export interface MinimapChromeState {
  readonly zoom: number;
  readonly size: MinimapSize;
  readonly filters: MinimapFilters;
  /** False on a whole-map view, where every owner shows and the scope cannot narrow it. */
  readonly hasSeat: boolean;
}

export interface MinimapChromeCallbacks {
  readonly onZoom: (delta: number) => void;
  readonly onReset: () => void;
  readonly onSize: () => void;
  readonly onLayer: (layer: MinimapLayer) => void;
  readonly onAllLayers: (shown: boolean) => void;
  readonly onScope: (scope: MinimapScope) => void;
  readonly onGround: (ground: MinimapGroundMode) => void;
  readonly onMarkerSize: (markerSize: MinimapMarkerSize) => void;
  readonly onColours: (colours: MinimapColourMode) => void;
}

export interface MinimapChrome {
  /** `panel` is in screen px; the receiving plane already applies `uiScale`. */
  setLayout(panel: Rect, visibleMap: Rect, uiScale: number): void;
  setState(state: MinimapChromeState): void;
  setHidden(hidden: boolean): void;
  setFrame(frame: MinimapFrame): void;
  dispose(): void;
}

const icon = (paths: string): string =>
  `<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">${paths}</svg>`;
const ICONS = {
  minus: icon('<path d="M5 10h10"/>'),
  plus: icon('<path d="M5 10h10M10 5v10"/>'),
  reset: icon('<path d="M7 3H3v4m10-4h4v4M3 13v4h4m10-4v4h-4"/><rect x="7" y="7" width="6" height="6"/>'),
  filters: icon('<path d="M3 5h14M3 10h14M3 15h14"/><path d="M7 3v4M13 8v4M8 13v4"/>'),
  colours: icon('<circle cx="10" cy="10" r="7"/><path d="M10 3a7 7 0 0 0 0 14z" fill="currentColor"/>'),
};
const LAYER_ICONS: Readonly<Record<MinimapLayer, string>> = {
  civilians: icon('<circle cx="10" cy="5" r="2.5"/><path d="M5 17v-4a5 5 0 0 1 10 0v4M8 17v-4m4 4v-4"/>'),
  soldiers: icon('<path d="M10 2 4 4.5V9c0 4 2.6 6.6 6 9 3.4-2.4 6-5 6-9V4.5z"/><path d="M10 6v8M7 9h6"/>'),
  buildings: icon('<path d="m2 9 8-6 8 6M5 8v9h10V8M8 17v-5h4v5"/>'),
  vehicles: icon('<path d="M2 13h16l-3 4H5zM10 3v10"/><path d="M10 4l5 7h-5"/>'),
  animals: icon(
    '<circle cx="10" cy="13" r="3"/><circle cx="4.5" cy="8.5" r="1.5"/><circle cx="8" cy="5" r="1.5"/><circle cx="12" cy="5" r="1.5"/><circle cx="15.5" cy="8.5" r="1.5"/>',
  ),
  roads: icon('<path d="M7 2 4 18M13 2l3 16M10 3v2m0 4v2m0 4v2"/>'),
  signposts: icon('<path d="M6 18V2M6 3h9l-2 3 2 3H6"/>'),
};

interface RadioChoices<T extends string> {
  readonly group: HTMLElement;
  /** Check `chosen` and make it the group's one tab stop. */
  choose(chosen: T): void;
}

/** A segmented control of `values`, inert while the group is marked disabled; `inline` lays it out in
 *  one row. A radio group is one tab stop; the arrow keys move the choice, as native radios do. */
function radioChoices<T extends string>(
  values: readonly T[],
  labelledBy: string,
  labels: Readonly<Record<T, string>>,
  tips: Readonly<Record<T, string>>,
  onChoose: (value: T) => void,
  inline = false,
): RadioChoices<T> {
  const group = element(
    'div',
    inline ? 'on-minimap-chrome__choices on-minimap-chrome__choices--inline' : 'on-minimap-chrome__choices',
  );
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-labelledby', labelledBy);
  const options = new Map<T, HTMLButtonElement>();
  for (const value of values) {
    const option = button('on-minimap-chrome__choice');
    option.setAttribute('role', 'radio');
    option.textContent = labels[value];
    setTip(option, tips[value]);
    option.addEventListener('click', () => {
      if (!isDisabled(group)) onChoose(value);
    });
    group.append(option);
    options.set(value, option);
  }
  group.addEventListener('keydown', (event) => {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    event.stopPropagation();
    if (isDisabled(group)) return;
    const at = values.findIndex((value) => options.get(value) === document.activeElement);
    const next = values[(Math.max(0, at) + step + values.length) % values.length];
    if (next === undefined) return;
    onChoose(next);
    options.get(next)?.focus();
  });
  return {
    group,
    choose: (chosen) => {
      for (const [value, option] of options) {
        const checked = value === chosen;
        setAttribute(option, 'aria-checked', String(checked));
        option.tabIndex = checked ? 0 : -1;
      }
    },
  };
}

/** The map hole stays transparent to pointer input; only the narrow rails and controls claim it. */
export function createMinimapChrome(
  plane: HTMLElement,
  callbacks: MinimapChromeCallbacks,
  initialFrame: MinimapFrame,
): MinimapChrome {
  const copy = messages().hud.minimap;
  const root = element('section', 'on-minimap-chrome');
  root.setAttribute('aria-label', copy.label);
  root.setAttribute('aria-description', copy.interaction);
  root.dataset.frame = initialFrame;
  const backing = createMinimapBacking(root);
  let uiScale = 1;
  const tooltip = element('div', 'on-minimap-tip');
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;
  plane.append(tooltip);
  const tips = attachTipLayer(
    root,
    {
      show: (clientX, clientY, text) => {
        write(tooltip, text);
        setHidden(tooltip, false);
        const bounds = plane.getBoundingClientRect();
        const x = (clientX - bounds.left) / uiScale;
        const y = (clientY - bounds.top) / uiScale;
        tooltip.style.left = `${Math.max(4, Math.min(x + 14, bounds.width / uiScale - tooltip.offsetWidth - 4))}px`;
        tooltip.style.top = `${Math.max(4, Math.min(y - tooltip.offsetHeight - 12, bounds.height / uiScale - tooltip.offsetHeight - 4))}px`;
      },
      hide: () => {
        setHidden(tooltip, true);
      },
    },
    200,
  );
  for (const edge of ['top', 'left', 'right', 'bottom']) {
    const rail = element('div', `on-minimap-chrome__rail on-minimap-chrome__rail--${edge}`);
    rail.setAttribute('aria-hidden', 'true');
    root.append(rail);
  }
  const frame = element('div', 'on-minimap-chrome__frame');
  frame.setAttribute('aria-hidden', 'true');
  root.append(frame);
  const controls = element('div', 'on-minimap-chrome__controls');
  const control = (name: string, label: string, content: string, action: () => void): HTMLButtonElement => {
    const node = button(`on-minimap-chrome__button on-minimap-chrome__button--${name}`, content);
    node.setAttribute('aria-label', label);
    setTip(node, label);
    node.addEventListener('click', () => {
      if (!isDisabled(node)) action();
    });
    controls.append(node);
    return node;
  };
  const less = control('less', copy.zoomOut, ICONS.minus, () => callbacks.onZoom(-1));
  const more = control('more', copy.zoomIn, ICONS.plus, () => callbacks.onZoom(1));
  control('reset', copy.reset, ICONS.reset, callbacks.onReset);
  const size = control('size', copy.size, '', callbacks.onSize);
  let colourMode: MinimapColourMode = 'players';
  const colourToggle = control('colours', copy.colourToggle, ICONS.colours, () =>
    callbacks.onColours(colourMode === 'players' ? 'stance' : 'players'),
  );
  const filterButton = control('filters', copy.filters, ICONS.filters, () =>
    showFilters(!filtersOpen(), true),
  );
  filterButton.setAttribute('aria-expanded', 'false');

  const popover = element('section', 'on-minimap-chrome__filters');
  popover.setAttribute('aria-label', copy.filters);
  // Closed, the popover stays laid out and painted but invisible, so its first opening is a flip, not a
  // first layout and raster of the drawer in the middle of play.
  popover.dataset.open = 'false';
  const filtersOpen = (): boolean => popover.dataset.open === 'true';
  const head = element('div', 'on-minimap-chrome__filters-head');
  const legend = element('h3', 'on-minimap-chrome__legend');
  legend.id = 'on-minimap-layers-legend';
  legend.textContent = copy.filters;
  let allShown = true;
  const allToggle = button('on-minimap-chrome__all');
  allToggle.addEventListener('click', () => callbacks.onAllLayers(!allShown));
  head.append(legend, allToggle);
  const layerGroup = element('div', 'on-minimap-chrome__layers');
  layerGroup.setAttribute('role', 'group');
  layerGroup.setAttribute('aria-labelledby', legend.id);
  const filterInputs = new Map<MinimapLayer, HTMLInputElement>();
  for (const layer of MINIMAP_LAYERS) {
    const row = element('label', 'on-minimap-chrome__filter');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.addEventListener('change', () => callbacks.onLayer(layer));
    const text = element('span', 'on-minimap-chrome__filter-text');
    text.textContent = copy.layers[layer];
    const symbol = element('span', 'on-minimap-chrome__filter-symbol', LAYER_ICONS[layer]);
    symbol.setAttribute('aria-hidden', 'true');
    row.append(symbol, text, input);
    setTip(row, copy.layerTips[layer]);
    layerGroup.append(row);
    filterInputs.set(layer, input);
  }
  const scopeLegend = element('h3', 'on-minimap-chrome__legend on-minimap-chrome__legend--scope');
  scopeLegend.id = 'on-minimap-scope-legend';
  scopeLegend.textContent = copy.scope;
  setTip(scopeLegend, copy.scopeNote);
  const scopes = radioChoices(MINIMAP_SCOPES, scopeLegend.id, copy.scopes, copy.scopeTips, callbacks.onScope);
  scopes.group.setAttribute('aria-description', copy.scopeNote);
  const noSeatNote = element('p', 'on-minimap-chrome__scope-note');
  noSeatNote.textContent = copy.scopeNoSeat;
  noSeatNote.hidden = true;
  const groundLegend = element('h3', 'on-minimap-chrome__legend on-minimap-chrome__legend--section');
  groundLegend.id = 'on-minimap-ground-legend';
  groundLegend.textContent = copy.ground;
  const grounds = radioChoices(
    MINIMAP_GROUND_MODES,
    groundLegend.id,
    copy.grounds,
    copy.groundTips,
    callbacks.onGround,
  );
  const markersLegend = element('h3', 'on-minimap-chrome__legend on-minimap-chrome__legend--section');
  markersLegend.id = 'on-minimap-markers-legend';
  markersLegend.textContent = copy.markerSize;
  const markers = radioChoices(
    MINIMAP_MARKER_SIZES,
    markersLegend.id,
    copy.markerSizes,
    copy.markerSizeTips,
    callbacks.onMarkerSize,
    true,
  );
  const coloursLegend = element('h3', 'on-minimap-chrome__legend on-minimap-chrome__legend--follow');
  coloursLegend.id = 'on-minimap-colours-legend';
  coloursLegend.textContent = copy.colours;
  const colours = radioChoices(
    MINIMAP_COLOUR_MODES,
    coloursLegend.id,
    copy.colourModes,
    copy.colourTips,
    callbacks.onColours,
    true,
  );
  popover.append(
    head,
    layerGroup,
    scopeLegend,
    scopes.group,
    noSeatNote,
    groundLegend,
    grounds.group,
    markersLegend,
    markers.group,
    coloursLegend,
    colours.group,
  );

  const placeFilters = (): void => {
    const bounds = plane.getBoundingClientRect();
    const width = bounds.width / uiScale;
    const height = bounds.height / uiScale;
    const drawerWidth = popover.offsetWidth;
    const drawerHeight = popover.offsetHeight;
    const right = root.offsetLeft + root.offsetWidth + 8;
    const x = Math.max(4, Math.min(right, width - drawerWidth - 4));
    let y = root.offsetTop + (root.offsetHeight - drawerHeight) / 2;
    const beam = plane.querySelector<HTMLElement>('.on-beam');
    if (beam?.checkVisibility()) {
      const beamBounds = beam.getBoundingClientRect();
      const beamLeft = (beamBounds.left - bounds.left) / uiScale;
      const beamRight = (beamBounds.right - bounds.left) / uiScale;
      const beamTop = (beamBounds.top - bounds.top) / uiScale;
      if (x < beamRight && x + drawerWidth > beamLeft) y = Math.min(y, beamTop - drawerHeight - 6);
    }
    y = Math.max(4, Math.min(y, height - drawerHeight - 4));
    popover.style.left = `${x - root.offsetLeft}px`;
    popover.style.top = `${y - root.offsetTop}px`;
  };
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') tips.hide();
    if (
      event.code === 'Space' &&
      (event.target instanceof HTMLButtonElement || event.target instanceof HTMLInputElement)
    )
      event.stopPropagation();
  });
  function onEscape(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    showFilters(false, true);
  }
  function showFilters(open: boolean, moveFocus = false): void {
    if (filtersOpen() === open) return;
    tips.hide();
    popover.dataset.open = String(open);
    setAttribute(filterButton, 'aria-expanded', String(open));
    if (open) {
      placeFilters();
      document.addEventListener('keydown', onEscape, true);
    } else document.removeEventListener('keydown', onEscape, true);
    if (moveFocus) {
      if (open) filterInputs.get(MINIMAP_LAYERS[0])?.focus();
      else filterButton.focus();
    }
  }
  const onOutsidePress = (event: PointerEvent): void => {
    if (event.target instanceof Node && !root.contains(event.target)) showFilters(false);
  };
  document.addEventListener('pointerdown', onOutsidePress, true);
  root.addEventListener('focusout', (event) => {
    if (event.relatedTarget instanceof Node && !root.contains(event.relatedTarget)) showFilters(false);
  });
  root.append(controls, popover);
  plane.append(root);

  let lastLayout = '';
  return {
    setLayout: (panel, visibleMap, scale) => {
      uiScale = scale;
      backing.setLayout(panel, visibleMap, scale);
      const layout = `${panel.x},${panel.y},${panel.w},${panel.h},${uiScale}`;
      if (layout === lastLayout) return;
      lastLayout = layout;
      Object.assign(root.style, {
        left: `${panel.x / uiScale}px`,
        top: `${panel.y / uiScale}px`,
        width: `${panel.w / uiScale}px`,
        height: `${panel.h / uiScale}px`,
      });
      placeFilters();
    },
    setState: (state) => {
      const zoomLabel = formatMessage(copy.zoom, { zoom: Math.round(state.zoom * 10) / 10 });
      for (const [node, label] of [
        [less, copy.zoomOut],
        [more, copy.zoomIn],
      ] as const) {
        const limit =
          node === less && state.zoom <= 1
            ? copy.minimumZoom
            : node === more && state.zoom >= 4
              ? copy.maximumZoom
              : '';
        const title = `${label} · ${zoomLabel}${limit === '' ? '' : `\n${limit}`}`;
        setTip(node, label);
        setAttribute(node, 'aria-label', title);
      }
      setDisabled(less, state.zoom <= 1);
      setDisabled(more, state.zoom >= 4);
      write(size, state.size.toUpperCase());
      const sizeLabel = formatMessage(copy.sizeState, { size: copy.sizes[state.size] });
      setTip(size, copy.size);
      setAttribute(size, 'aria-label', sizeLabel);
      for (const [layer, input] of filterInputs) {
        if (input.checked !== state.filters.layers[layer]) input.checked = state.filters.layers[layer];
      }
      allShown = allMinimapLayersShown(state.filters);
      write(allToggle, allShown ? copy.hideAll : copy.showAll);
      scopes.choose(state.filters.scope);
      setDisabled(scopes.group, !state.hasSeat);
      grounds.choose(state.filters.ground);
      markers.choose(state.filters.markerSize);
      colours.choose(state.filters.colours);
      setDisabled(colours.group, !state.hasSeat);
      colourMode = state.filters.colours;
      // A whole-map view paints team colours whatever is stored, so the button names what shows.
      const shownMode: MinimapColourMode = state.hasSeat ? colourMode : 'players';
      setAttribute(colourToggle, 'aria-pressed', String(shownMode === 'stance'));
      setAttribute(
        colourToggle,
        'aria-label',
        formatMessage(copy.colourToggleState, { mode: copy.colourModes[shownMode] }),
      );
      setDisabled(colourToggle, !state.hasSeat);
      if (setHidden(noSeatNote, state.hasSeat)) placeFilters();
      tips.refresh();
    },
    setHidden: (hidden) => {
      if (hidden) {
        showFilters(false);
        tips.hide();
      }
      setHidden(root, hidden);
    },
    setFrame: (next) => {
      root.dataset.frame = next;
    },
    dispose: () => {
      showFilters(false);
      document.removeEventListener('pointerdown', onOutsidePress, true);
      tips.dispose();
      tooltip.remove();
      root.remove();
    },
  };
}
