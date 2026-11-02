// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeTarget, KnowledgeView } from '../../../../src/hud/dom/knowledge/context.js';
import { createKnowledgeWindow, knowledgeWindowWidth } from '../../../../src/hud/dom/knowledge/window.js';

const settle = (): Promise<void> => new Promise((done) => setTimeout(done));

function stubView() {
  const opened: (KnowledgeTarget | undefined)[] = [];
  let layers = 0;
  const view: KnowledgeView = {
    element: document.createElement('div'),
    head: document.createElement('div'),
    open: (target) => opened.push(target),
    escape: () => {
      layers -= 1;
      return layers >= 0;
    },
    close: vi.fn(),
    dispose: vi.fn(),
  };
  return { view, opened, setLayers: (n: number) => (layers = n) };
}

function mount() {
  const plane = document.createElement('div');
  document.body.append(plane);
  const stub = stubView();
  const createView = vi.fn(() => Promise.resolve(stub.view));
  const refresh = vi.fn(() => Promise.resolve());
  const window = createKnowledgeWindow({
    plane,
    title: 'Knowledge',
    art: '',
    closeLabel: 'Close',
    createView,
    refresh,
    buildingId: (typeId) => (typeId === 7 ? 'work_smithy_00' : undefined),
  });
  return { ...stub, window, createView, refresh };
}

describe('the Knowledge window', () => {
  afterEach(() => document.body.replaceChildren());

  it('tells the view every way it closes', async () => {
    const { window, view } = mount();
    window.toggle();
    await settle();
    window.toggle();
    window.show();
    window.close();
    window.show();
    document.querySelector<HTMLElement>('.on-window__close')?.click();
    expect(view.close).toHaveBeenCalledTimes(3);
  });

  it('builds nothing until the first open, then only once', async () => {
    const { window, createView, refresh, opened } = mount();
    window.place();
    expect(createView).not.toHaveBeenCalled();
    window.toggle();
    await settle();
    expect(window.isOpen()).toBe(true);
    window.toggle();
    window.toggle();
    await settle();
    expect(createView).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(opened).toEqual([undefined, undefined]);
  });

  it("opens a building's entry, and lands where it left off for a type no entry holds", async () => {
    const { window, opened } = mount();
    window.showBuilding(7);
    await settle();
    window.showBuilding(99);
    await settle();
    expect(opened).toEqual([{ entry: { kind: 'building', id: 'work_smithy_00' } }, undefined]);
  });

  it('renders only the last open when reads overlap, and nothing once closed', async () => {
    const { window, opened } = mount();
    window.toggle();
    window.showBuilding(7);
    await settle();
    expect(opened).toEqual([{ entry: { kind: 'building', id: 'work_smithy_00' } }]);
    window.toggle();
    window.toggle();
    window.close();
    await settle();
    expect(opened).toHaveLength(1);
  });

  it('asks the view to take Esc before the panel closes it', async () => {
    const { window, setLayers } = mount();
    expect(window.escape()).toBe(false);
    window.toggle();
    await settle();
    setLayers(1);
    expect(window.escape()).toBe(true);
    expect(window.escape()).toBe(false);
  });

  it('takes the design width, and leaves a gap on each side of a narrow screen', () => {
    expect(knowledgeWindowWidth({ width: 1920, height: 1080 })).toBe(1080);
    expect(knowledgeWindowWidth({ width: 1000, height: 768 })).toBe(976);
  });
});
