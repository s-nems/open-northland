/**
 * The ring that blooms under the pointer the moment a command is sent. In lockstep the command applies
 * a few ticks later, so the cue is what tells the player the click landed; the sim's own reaction
 * follows when the tick runs.
 */

const STYLE_ID = 'on-order-cue-style';
const CUE_SIZE_PX = 28;
const CUE_DURATION_MS = 320;
/** Over the canvas and the perf overlay, under every panel that takes input. */
const CUE_Z_INDEX = '60';
const CUE_STYLE = [
  'position:fixed',
  `width:${CUE_SIZE_PX}px`,
  `height:${CUE_SIZE_PX}px`,
  'border:2px solid #e8dcc0',
  'border-radius:50%',
  'box-shadow:0 0 6px rgba(232,220,192,0.8)',
  'pointer-events:none',
  `z-index:${CUE_Z_INDEX}`,
  `animation:on-order-cue ${CUE_DURATION_MS}ms ease-out forwards`,
].join(';');

export interface OrderCue {
  at(clientX: number, clientY: number): void;
  dispose(): void;
}

function ensureKeyframes(): void {
  if (document.getElementById(STYLE_ID) !== null) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent =
    '@keyframes on-order-cue{from{transform:translate(-50%,-50%) scale(0.4);opacity:0.95}' +
    'to{transform:translate(-50%,-50%) scale(1.5);opacity:0}}';
  document.head.append(style);
}

export function createOrderCue(): OrderCue {
  ensureKeyframes();
  const live = new Set<HTMLElement>();
  return {
    at(clientX, clientY): void {
      const ring = document.createElement('div');
      ring.style.cssText = CUE_STYLE;
      ring.style.left = `${clientX}px`;
      ring.style.top = `${clientY}px`;
      const remove = (): void => {
        ring.remove();
        live.delete(ring);
      };
      ring.addEventListener('animationend', remove, { once: true });
      // A tab without animations (reduced motion, hidden) never fires the end event.
      setTimeout(remove, CUE_DURATION_MS * 2);
      live.add(ring);
      document.body.append(ring);
    },
    dispose(): void {
      for (const ring of live) ring.remove();
      live.clear();
    },
  };
}
