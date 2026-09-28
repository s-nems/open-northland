import type { Rect } from '../geometry.js';
import './paper.css';

export interface MinimapPaper {
  /** Both rectangles use screen px. The map rectangle is already clipped to the minimap hole. */
  setLayout(panel: Rect, visibleMapRect: Rect, uiScale: number): void;
  dispose(): void;
}

const FRAME_INSET = 20;
const UNDER_FRAME = 12;
const SAMPLE_SCALE = 32 / 190;
const TILE_WIDTH = 800 * SAMPLE_SCALE;
const EDGE_OFFSET = 2;
const FILL_TILE_WIDTH = 330 * SAMPLE_SCALE;
const FILL_TILE_HEIGHT = 28 * SAMPLE_SCALE;

interface PaperBand {
  readonly element: HTMLDivElement;
  readonly fill: HTMLDivElement;
  readonly edge: HTMLDivElement;
  edgeTiles: number;
  fillRows: number;
  fillColumns: number;
}

function band(): PaperBand {
  const element = document.createElement('div');
  element.className = 'on-minimap-paper__band';
  const fill = document.createElement('div');
  fill.className = 'on-minimap-paper__fill';
  const edge = document.createElement('div');
  edge.className = 'on-minimap-paper__edge';
  element.append(fill, edge);
  return { element, fill, edge, edgeTiles: 0, fillRows: 0, fillColumns: 0 };
}

/** Only straight, undecorated paper samples repeat; the original outer frame keeps every corner. */
export function createMinimapPaper(root: HTMLElement): MinimapPaper {
  const paper = document.createElement('div');
  paper.className = 'on-minimap-paper';
  paper.setAttribute('aria-hidden', 'true');
  const bands = { top: band(), bottom: band(), left: band(), right: band() };
  paper.append(bands.top.element, bands.bottom.element, bands.left.element, bands.right.element);
  root.prepend(paper);
  let lastLayout = '';

  const positionBand = (
    target: PaperBand,
    x: number,
    y: number,
    length: number,
    depth: number,
    turn: number,
    visible: boolean,
  ): void => {
    target.element.hidden = !visible || length <= 0;
    if (target.element.hidden) return;
    const edgeCount = Math.ceil(length / TILE_WIDTH);
    while (target.edgeTiles < edgeCount) {
      const tile = document.createElement('span');
      tile.className = 'on-minimap-paper__tile';
      target.edge.append(tile);
      target.edgeTiles += 1;
    }
    const fillHeight = Math.max(0, depth - EDGE_OFFSET);
    const rows = Math.ceil(fillHeight / FILL_TILE_HEIGHT);
    const columns = Math.ceil(length / FILL_TILE_WIDTH);
    if (rows !== target.fillRows || columns !== target.fillColumns) {
      const fragment = document.createDocumentFragment();
      for (let y = 0; y < rows; y += 1) {
        const row = document.createElement('div');
        row.className = 'on-minimap-paper__row';
        for (let x = 0; x < columns; x += 1) {
          const tile = document.createElement('span');
          tile.className = 'on-minimap-paper__tile';
          row.append(tile);
        }
        fragment.append(row);
      }
      target.fill.replaceChildren(fragment);
      target.fillRows = rows;
      target.fillColumns = columns;
    }
    Object.assign(target.element.style, {
      left: `${x}px`,
      top: `${y}px`,
      width: `${length}px`,
      height: `${depth}px`,
      transform: `rotate(${turn}deg)`,
    });
    target.element.style.setProperty('--paper-fill-height', `${fillHeight}px`);
  };

  return {
    setLayout(panel, visibleMapRect, uiScale) {
      const key = `${panel.x},${panel.y},${panel.w},${panel.h},${visibleMapRect.x},${visibleMapRect.y},${visibleMapRect.w},${visibleMapRect.h},${uiScale}`;
      if (key === lastLayout) return;
      lastLayout = key;
      const width = panel.w / uiScale;
      const height = panel.h / uiScale;
      const mapLeft = Math.max(FRAME_INSET, (visibleMapRect.x - panel.x) / uiScale);
      const mapTop = Math.max(FRAME_INSET, (visibleMapRect.y - panel.y) / uiScale);
      const mapRight = Math.min(
        width - FRAME_INSET,
        (visibleMapRect.x + visibleMapRect.w - panel.x) / uiScale,
      );
      const mapBottom = Math.min(
        height - FRAME_INSET,
        (visibleMapRect.y + visibleMapRect.h - panel.y) / uiScale,
      );
      paper.hidden = visibleMapRect.w <= 0 || visibleMapRect.h <= 0;
      if (paper.hidden) {
        delete root.dataset.minimapPaperBands;
        return;
      }
      const vertical = mapTop > FRAME_INSET + 0.1 || mapBottom < height - FRAME_INSET - 0.1;
      const horizontal = mapLeft > FRAME_INSET + 0.1 || mapRight < width - FRAME_INSET - 0.1;
      root.dataset.minimapPaperBands = vertical
        ? horizontal
          ? 'both'
          : 'vertical'
        : horizontal
          ? 'horizontal'
          : 'none';
      positionBand(
        bands.top,
        UNDER_FRAME,
        UNDER_FRAME,
        width - 2 * UNDER_FRAME,
        mapTop - UNDER_FRAME,
        0,
        mapTop > FRAME_INSET + 0.1,
      );
      positionBand(
        bands.bottom,
        width - UNDER_FRAME,
        height - UNDER_FRAME,
        width - 2 * UNDER_FRAME,
        height - UNDER_FRAME - mapBottom,
        180,
        mapBottom < height - FRAME_INSET - 0.1,
      );
      positionBand(
        bands.left,
        UNDER_FRAME,
        mapBottom,
        mapBottom - mapTop,
        mapLeft - UNDER_FRAME,
        -90,
        mapLeft > FRAME_INSET + 0.1,
      );
      positionBand(
        bands.right,
        width - UNDER_FRAME,
        mapTop,
        mapBottom - mapTop,
        width - UNDER_FRAME - mapRight,
        90,
        mapRight < width - FRAME_INSET - 0.1,
      );
    },
    dispose: () => {
      paper.remove();
      delete root.dataset.minimapPaperBands;
    },
  };
}
