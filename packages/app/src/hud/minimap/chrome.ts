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
import type { MinimapFrame } from './frames.js';
import type { MinimapSize } from './model.js';
import './chrome.css';

export type MinimapFilterKey = 'people' | 'buildings';

export interface MinimapChromeState {
  readonly zoom: number;
  readonly size: MinimapSize;
  readonly filters: Readonly<Record<MinimapFilterKey, boolean>>;
}

export interface MinimapChromeCallbacks {
  readonly onZoom: (delta: number) => void;
  readonly onReset: () => void;
  readonly onSize: () => void;
  readonly onFilter: (key: MinimapFilterKey) => void;
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
};

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
  const filterButton = control('filters', copy.filters, ICONS.filters, () =>
    showFilters(Boolean(popover.hidden), true),
  );
  filterButton.setAttribute('aria-expanded', 'false');

  const popover = element('section', 'on-minimap-chrome__filters');
  popover.setAttribute('aria-label', copy.filters);
  popover.hidden = true;
  const legend = element('h3', 'on-minimap-chrome__legend');
  legend.textContent = copy.filters;
  popover.append(legend);
  const filterInputs = new Map<MinimapFilterKey, HTMLInputElement>();
  for (const key of ['people', 'buildings'] as const) {
    const row = element('label', 'on-minimap-chrome__filter');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.addEventListener('change', () => callbacks.onFilter(key));
    const text = document.createElement('span');
    text.textContent = copy.layers[key];
    const symbol = element(
      'span',
      'on-minimap-chrome__filter-symbol',
      key === 'people'
        ? icon('<circle cx="10" cy="5" r="2.5"/><path d="M5 17v-4a5 5 0 0 1 10 0v4M8 17v-4m4 4v-4"/>')
        : icon('<path d="m2 9 8-6 8 6M5 8v9h10V8M8 17v-5h4v5"/>'),
    );
    symbol.setAttribute('aria-hidden', 'true');
    row.append(symbol, text, input);
    popover.append(row);
    filterInputs.set(key, input);
  }

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
    if (popover.hidden === !open) return;
    tips.hide();
    setHidden(popover, !open);
    setAttribute(filterButton, 'aria-expanded', String(open));
    if (open) {
      placeFilters();
      document.addEventListener('keydown', onEscape, true);
    } else document.removeEventListener('keydown', onEscape, true);
    if (moveFocus) {
      if (open) filterInputs.get('people')?.focus();
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
      if (!popover.hidden) placeFilters();
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
      for (const [key, input] of filterInputs) {
        if (input.checked !== state.filters[key]) input.checked = state.filters[key];
      }
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
