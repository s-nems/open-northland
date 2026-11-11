// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  createNoticeColumn,
  type NoticeCardView,
  type NoticeMemberView,
  type NoticeStackView,
} from '../../../../src/hud/dom/notices/column.js';
import type { NoticeThumb } from '../../../../src/hud/tool-panel/messages/cards.js';
import type { MessagePriorityLevel } from '../../../../src/hud/tool-panel/messages/types.js';

const ROUTINE: MessagePriorityLevel = 0;
const SCROLL: NoticeThumb = { kind: 'glyph', glyph: 'scroll', dim: false, seat: null };
const STACK_KEY = 'hungry';

const card = (id: number, canGo: boolean): NoticeCardView => ({
  id,
  level: ROUTINE,
  short: `note ${id}`,
  full: `the whole note ${id}`,
  thumb: SCROLL,
  canGo,
  fresh: false,
});
const member = (id: number): NoticeMemberView => ({
  id,
  level: ROUTINE,
  label: `settler ${id}`,
  detail: '',
  age: '',
  full: `settler ${id} is hungry`,
  thumb: SCROLL,
  canGo: true,
});
/** A two-note stack and a lone note with no place to go, whose card press pins its bubble. */
const stacksFor = (open: string | null): NoticeStackView[] => [
  {
    key: STACK_KEY,
    lead: card(1, true),
    count: 2,
    breakdown: '2 hungry',
    members: open === STACK_KEY ? [member(1), member(2)] : null,
  },
  { key: 'found', lead: card(3, false), count: 1, breakdown: '', members: null },
];

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it('a press off the column closes the open stack and the pinned bubble, and keeps the notes', () => {
  const plane = document.createElement('div');
  const map = document.createElement('canvas');
  document.body.append(plane, map);
  let open: string | null = null;
  const column = createNoticeColumn({
    plane,
    bottomInset: 0,
    paintBuilding: () => false,
    paintGlyph: () => false,
    onLevel: () => {},
    onGo: () => {},
    onDismiss: () => {},
    onDismissGroup: () => {},
    onDismissAll: () => {},
    onOpen: (key) => {
      open = key;
    },
  });
  const render = (): void => column.render(stacksFor(open), [2, 0, 0], ROUTINE, open);
  const press = (target: Element): void => {
    target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    render();
  };
  const find = (selector: string): Element => {
    const found = plane.querySelector(selector);
    if (found === null) throw new Error(`${selector} missing`);
    return found;
  };
  const rowsListed = (): boolean => plane.querySelector('.on-members') !== null;
  const bubble = find('.on-notices__full');
  render();

  press(find('.on-notice__toggle'));
  expect(rowsListed()).toBe(true);
  press(find('.on-member'));
  expect(rowsListed()).toBe(true);
  press(map);
  expect(rowsListed()).toBe(false);

  press(find('[data-key="found"] .on-notice__card'));
  expect(bubble.hasAttribute('hidden')).toBe(false);
  press(map);
  expect(bubble.hasAttribute('hidden')).toBe(true);
  expect(plane.querySelectorAll('.on-notice')).toHaveLength(2);
  column.dispose();
});
