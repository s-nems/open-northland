import type { Rect } from '../geometry.js';

export interface MinimapBacking {
  /** Both rectangles use screen px. The map rectangle is already clipped to the minimap hole. */
  setLayout(panel: Rect, visibleMapRect: Rect, uiScale: number): void;
}

/** Fills the hole around a map narrower than the panel; the mask cuts the map rectangle out. */
export function createMinimapBacking(root: HTMLElement): MinimapBacking {
  const backing = document.createElement('div');
  backing.className = 'on-minimap-backing';
  backing.setAttribute('aria-hidden', 'true');
  const edge = document.createElement('div');
  edge.className = 'on-minimap-backing__edge';
  backing.append(edge);
  root.prepend(backing);
  let lastLayout = '';
  return {
    setLayout(panel, visibleMapRect, uiScale) {
      const key = `${panel.x},${panel.y},${visibleMapRect.x},${visibleMapRect.y},${visibleMapRect.w},${visibleMapRect.h},${uiScale}`;
      if (key === lastLayout) return;
      lastLayout = key;
      backing.hidden = visibleMapRect.w <= 0 || visibleMapRect.h <= 0;
      if (backing.hidden) return;
      const x = (visibleMapRect.x - panel.x) / uiScale;
      const y = (visibleMapRect.y - panel.y) / uiScale;
      backing.style.setProperty('--map-x', `${x}px`);
      backing.style.setProperty('--map-y', `${y}px`);
      backing.style.setProperty('--map-w', `${visibleMapRect.w / uiScale}px`);
      backing.style.setProperty('--map-h', `${visibleMapRect.h / uiScale}px`);
    },
  };
}
