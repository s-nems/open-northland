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

export interface MarqueeRelease {
  readonly startX: number;
  readonly startY: number;
  readonly moved: boolean;
}

/** Own the DOM rectangle and drag threshold for box-selection. */
export function createSelectionMarquee(): {
  readonly begin: (clientX: number, clientY: number) => void;
  readonly update: (clientX: number, clientY: number) => void;
  readonly release: (clientX: number, clientY: number) => MarqueeRelease | null;
  readonly active: () => boolean;
  readonly dispose: () => void;
} {
  const element = document.createElement('div');
  element.style.cssText = MARQUEE_STYLE;
  document.body.append(element);
  let dragging = false;
  let startX = 0;
  let startY = 0;

  return {
    begin(clientX, clientY) {
      dragging = true;
      startX = clientX;
      startY = clientY;
    },
    update(clientX, clientY) {
      if (!dragging) return;
      const dx = Math.abs(clientX - startX);
      const dy = Math.abs(clientY - startY);
      if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return;
      element.style.display = 'block';
      element.style.left = `${Math.min(startX, clientX)}px`;
      element.style.top = `${Math.min(startY, clientY)}px`;
      element.style.width = `${dx}px`;
      element.style.height = `${dy}px`;
    },
    release(clientX, clientY) {
      if (!dragging) return null;
      dragging = false;
      element.style.display = 'none';
      return {
        startX,
        startY,
        moved: Math.abs(clientX - startX) >= DRAG_THRESHOLD || Math.abs(clientY - startY) >= DRAG_THRESHOLD,
      };
    },
    active: () => dragging,
    dispose: () => element.remove(),
  };
}
