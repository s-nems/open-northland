// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { navBeamRect } from '../../../src/hud/nav-beam.js';
import { SELECTION_PANEL_W } from '../../../src/hud/regions.js';

/** Every observer made on the page, so a test can report a resize to the ones watching a target. */
const observers: { callback: ResizeObserverCallback; targets: Set<Element> }[] = [];

class FakeResizeObserver {
  private readonly entry: { callback: ResizeObserverCallback; targets: Set<Element> };
  constructor(callback: ResizeObserverCallback) {
    this.entry = { callback, targets: new Set() };
    observers.push(this.entry);
  }
  observe(target: Element): void {
    this.entry.targets.add(target);
  }
  unobserve(target: Element): void {
    this.entry.targets.delete(target);
  }
  disconnect(): void {
    this.entry.targets.clear();
  }
}

function reportResize(target: Element): void {
  for (const { callback, targets } of observers)
    if (targets.has(target)) callback([{ target } as ResizeObserverEntry], {} as unknown as ResizeObserver);
}

/** A plane whose client box the test sets, as the observer would read it after a layout. */
function plane(width: number, height: number): HTMLElement & { resize(w: number, h: number): void } {
  const element = document.createElement('div');
  let box = { width, height };
  Object.defineProperty(element, 'clientWidth', { get: () => box.width });
  Object.defineProperty(element, 'clientHeight', { get: () => box.height });
  document.body.append(element);
  return Object.assign(element, {
    resize: (w: number, h: number) => {
      box = { width: w, height: h };
    },
  });
}

describe('selection panel placement', () => {
  beforeEach(() => {
    observers.length = 0;
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("stands above the beam from the plane's resize report, without waiting for its next show", async () => {
    const { createSelectionPanel } = await import('../../../src/hud/dom/selection-panel.js');
    // Wide enough that the beam ends left of the panel's column.
    const wide = 1920;
    const height = 1080;
    const host = plane(wide, height);
    const panel = createSelectionPanel(
      host,
      {
        onBrowse: () => {},
        onOrders: () => {},
        onKickerDoubleClick: () => {},
        onRename: () => {},
        onClose: () => {},
      },
      { show: () => {}, hide: () => {} },
    );
    panel.show();
    expect(panel.element.style.bottom).toBe('0px');
    // A UI scale that narrows the design-px screen until the beam reaches under the panel.
    const narrow = SELECTION_PANEL_W + 400;
    const beam = navBeamRect({ width: narrow, height }, 1);
    expect(beam.x + beam.w).toBeGreaterThan(narrow - SELECTION_PANEL_W);
    host.resize(narrow, height);
    reportResize(host);
    expect(panel.element.style.bottom).toBe(`${beam.h}px`);
    panel.dispose();
  });
});

describe('selection panel rename', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("opens the field on the player's own name, not the title that shows the generated one beside it", async () => {
    const { createSelectionPanel } = await import('../../../src/hud/dom/selection-panel.js');
    const renamed: string[] = [];
    const panel = createSelectionPanel(
      plane(1920, 1080),
      {
        onBrowse: () => {},
        onOrders: () => {},
        onKickerDoubleClick: () => {},
        onRename: (name) => renamed.push(name),
        onClose: () => {},
      },
      { show: () => {}, hide: () => {} },
    );
    panel.updateHead({
      kicker: '',
      browse: null,
      title: 'Ada (Harald)',
      rename: { tooltip: 'Rename', maxLength: 24, current: 'Ada' },
      meta: null,
      orders: null,
      labels: { close: 'Close', prev: 'Prev', next: 'Next' },
    });
    const pen = panel.element.querySelector<HTMLElement>('.on-rename');
    const field = panel.element.querySelector<HTMLInputElement>('.on-rename-field');
    if (pen === null || field === null) throw new Error('no rename controls');
    const submit = (): void => {
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    };
    pen.click();
    expect(field.value).toBe('Ada');
    // An unchanged name is no rename.
    submit();
    expect(renamed).toEqual([]);
    pen.click();
    field.value = 'Adam';
    submit();
    expect(renamed).toEqual(['Adam']);
    panel.dispose();
  });
});
