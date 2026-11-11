/** Drag distance (client px) beyond which a press is a marquee, not a click. */
const DRAG_THRESHOLD = 5;

const MARQUEE_STYLE = [
  'position:fixed',
  'border:1px solid #66ff66',
  'background:rgba(102,255,102,0.12)',
  'pointer-events:none',
  'z-index:55',
  'display:none',
].join(';');

interface Point {
  readonly x: number;
  readonly y: number;
}

/** The camera's mapping between client (CSS) px and world px, read as each call lands. */
export interface MarqueeProjection {
  readonly toWorld: (clientX: number, clientY: number) => Point;
  readonly toClient: (worldX: number, worldY: number) => Point;
}

export interface MarqueeRelease {
  /** The world point the drag began on, wherever the camera has scrolled since. */
  readonly start: Point;
  readonly moved: boolean;
}

/**
 * The selection box anchors its start corner to the world point pressed, as RTS boxes do: a camera
 * that scrolls during the drag stretches the box over the scrolled ground instead of carrying the
 * corner along the screen.
 */
export function createSelectionMarquee(projection: MarqueeProjection): {
  readonly begin: (clientX: number, clientY: number) => void;
  readonly update: (clientX: number, clientY: number) => void;
  readonly release: (clientX: number, clientY: number) => MarqueeRelease | null;
  readonly active: () => boolean;
  readonly dispose: () => void;
} {
  const element = document.createElement('div');
  element.style.cssText = MARQUEE_STYLE;
  document.body.append(element);
  let anchor: Point | null = null;

  /** The anchor on screen under the camera now, and whether the pointer is a drag away from it. */
  const span = (start: Point, clientX: number, clientY: number) => {
    const from = projection.toClient(start.x, start.y);
    const dx = Math.abs(clientX - from.x);
    const dy = Math.abs(clientY - from.y);
    return { from, dx, dy, moved: dx >= DRAG_THRESHOLD || dy >= DRAG_THRESHOLD };
  };

  return {
    begin(clientX, clientY) {
      anchor = projection.toWorld(clientX, clientY);
    },
    update(clientX, clientY) {
      if (anchor === null) return;
      const { from, dx, dy, moved } = span(anchor, clientX, clientY);
      if (!moved) return;
      element.style.display = 'block';
      element.style.left = `${Math.min(from.x, clientX)}px`;
      element.style.top = `${Math.min(from.y, clientY)}px`;
      element.style.width = `${dx}px`;
      element.style.height = `${dy}px`;
    },
    release(clientX, clientY) {
      if (anchor === null) return null;
      const start = anchor;
      anchor = null;
      element.style.display = 'none';
      return { start, moved: span(start, clientX, clientY).moved };
    },
    active: () => anchor !== null,
    dispose: () => element.remove(),
  };
}
