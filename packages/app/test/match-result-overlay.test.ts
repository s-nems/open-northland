import { afterEach, expect, it, vi } from 'vitest';
import { createMatchResultOverlay } from '../src/view/match-result.js';

class Element extends EventTarget {
  readonly style: Record<string, string> = {};
  readonly children: Element[] = [];
  textContent = '';
  type = '';
  parent: Element | null = null;
  constructor(readonly tag: string) {
    super();
  }
  setAttribute(): void {}
  focus(): void {}
  append(...children: Element[]): void {
    for (const child of children) {
      child.parent = this;
      this.children.push(child);
    }
  }
  remove(): void {
    if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }
  buttons(): Element[] {
    return this.children.flatMap((child) => (child.tag === 'button' ? [child] : child.buttons()));
  }
}
afterEach(() => vi.unstubAllGlobals());
function setup(sharedClock: boolean) {
  const body = new Element('body');
  vi.stubGlobal('document', { body, createElement: (tag: string) => new Element(tag) });
  const pause = vi.fn();
  const resume = vi.fn();
  const onQuit = vi.fn();
  const overlay = createMatchResultOverlay({
    localPlayer: 0,
    sharedClock,
    pause,
    resume,
    onQuit,
    uiString: (_page, _id, fallback) => fallback,
  });
  return { body, pause, resume, onQuit, overlay };
}

it('lets a defeated player watch without pausing, then replaces the verdict with a terminal result', () => {
  const h = setup(true);
  h.overlay.announce('defeat');
  expect(h.body.buttons()).toHaveLength(2);
  h.body.buttons()[0]?.dispatchEvent(new Event('click'));
  expect(h.body.children).toHaveLength(0);
  expect(h.pause).not.toHaveBeenCalled();
  expect(h.resume).not.toHaveBeenCalled();
  h.overlay.finish('defeat');
  expect(h.body.children).toHaveLength(1);
  expect(h.body.buttons()).toHaveLength(1);
  h.overlay.finish('defeat');
  h.overlay.announce('victory');
  expect(h.body.children).toHaveLength(1);
  h.body.buttons()[0]?.dispatchEvent(new Event('click'));
  expect(h.onQuit).toHaveBeenCalledOnce();
  expect(h.body.children).toHaveLength(0);
});

it('replaces an open earlier defeat and supports an observer without a local outcome', () => {
  const h = setup(true);
  h.overlay.announce('defeat');
  h.overlay.finish('undecided');
  expect(h.body.children).toHaveLength(1);
  expect(h.body.buttons()).toHaveLength(1);
  h.overlay.dispose();
  expect(h.body.children).toHaveLength(0);
});

it('keeps single-player pause and continue behavior', () => {
  const h = setup(false);
  h.overlay.announce('victory');
  expect(h.pause).toHaveBeenCalledOnce();
  expect(h.body.buttons()).toHaveLength(2);
  h.body.buttons()[0]?.dispatchEvent(new Event('click'));
  expect(h.resume).toHaveBeenCalledOnce();
  h.overlay.announce('victory');
  expect(h.body.children).toHaveLength(0);
});

it('waits for server confirmation before showing shared victory', () => {
  const h = setup(true);
  h.overlay.announce('victory');
  expect(h.body.children).toHaveLength(0);
  h.overlay.finish('victory');
  expect(h.body.buttons()).toHaveLength(1);
  expect(h.pause).not.toHaveBeenCalled();
});
