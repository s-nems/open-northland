import { terrainWorldBounds } from '@open-northland/render';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMinimapInput } from '../src/hud/minimap/input.js';
import { minimapLayout, zoomMinimapLayout } from '../src/hud/minimap/model.js';

let windowTarget: EventTarget;
beforeEach(() => {
  windowTarget = new EventTarget();
  vi.stubGlobal('window', windowTarget);
});
afterEach(() => vi.unstubAllGlobals());
const mouse = (type: string, x: number, y: number, button = 0): Event =>
  Object.assign(new Event(type, { cancelable: true }), { clientX: x, clientY: y, button });

function mount() {
  const bounds = terrainWorldBounds(64, 64);
  let layout = minimapLayout(bounds, 800, 1);
  let enabled = true;
  const canvas = new EventTarget() as HTMLCanvasElement;
  const onJump = vi.fn();
  const onOrder = vi.fn((_x: number, _y: number, _event: MouseEvent) => false);
  const onPan = vi.fn();
  const onZoom = vi.fn();
  const input = createMinimapInput({
    canvas,
    bounds,
    layout: () => layout,
    enabled: () => enabled,
    toScreenPx: (x, y) => ({ x, y }),
    onJump,
    onOrder,
    onPan,
    onZoom,
  });
  return {
    canvas,
    input,
    onJump,
    onOrder,
    onPan,
    onZoom,
    bounds,
    layout: () => layout,
    setLayout: (next: typeof layout) => {
      layout = next;
    },
    hide: () => {
      enabled = false;
      input.cancel();
    },
  };
}

describe('Atlas input ownership', () => {
  it('offers a projected press to orders first and never starts a camera drag when consumed', () => {
    const m = mount();
    const base = m.layout();
    m.setLayout(zoomMinimapLayout(base, m.bounds, 2, { x: m.bounds.width / 2, y: m.bounds.height / 2 }));
    const r = m.layout().inner;
    m.onOrder.mockReturnValue(true);
    const press = mouse('mousedown', r.x + r.w / 2, r.y + r.h / 2);
    m.canvas.dispatchEvent(press);
    expect(m.onOrder).toHaveBeenCalledOnce();
    expect(Number.isFinite(m.onOrder.mock.calls[0]?.[0])).toBe(true);
    expect(press.defaultPrevented).toBe(true);
    expect(m.onJump).not.toHaveBeenCalled();
    expect(m.input.dragging()).toBe(false);
    m.input.dispose();
  });

  it('pans the zoomed map with middle drag, ignores collapsed layouts, and releases on blur', () => {
    const m = mount();
    const base = m.layout();
    m.setLayout(
      zoomMinimapLayout(base, m.bounds, 2, {
        x: m.bounds.minX + m.bounds.width / 2,
        y: m.bounds.minY + m.bounds.height / 2,
      }),
    );
    const r = m.layout().inner;
    m.canvas.dispatchEvent(mouse('mousedown', r.x + 30, r.y + 30, 1));
    windowTarget.dispatchEvent(mouse('mousemove', r.x + 40, r.y + 25, 1));
    expect(m.onPan).toHaveBeenCalledWith(-10 / m.layout().scaleX, 5 / m.layout().scaleY);
    expect(m.onOrder).not.toHaveBeenCalled();
    expect(m.onJump).not.toHaveBeenCalled();
    m.setLayout(minimapLayout(m.bounds, 0, 1));
    windowTarget.dispatchEvent(mouse('mousemove', r.x + 40, r.y + 25, 1));
    expect(m.onPan).toHaveBeenCalledOnce();
    windowTarget.dispatchEvent(new Event('blur'));
    expect(m.input.dragging()).toBe(false);
    m.input.dispose();
  });

  it('isolates wheel zoom to the map and stops responding when hidden or disposed', () => {
    const m = mount();
    const r = m.layout().inner;
    const wheel = Object.assign(new Event('wheel', { cancelable: true }), {
      clientX: r.x + 20,
      clientY: r.y + 20,
      deltaY: -100,
    });
    m.canvas.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
    expect(m.onZoom).toHaveBeenCalledOnce();
    m.hide();
    m.canvas.dispatchEvent(wheel);
    m.input.dispose();
    m.canvas.dispatchEvent(wheel);
    expect(m.onZoom).toHaveBeenCalledOnce();
  });
});
