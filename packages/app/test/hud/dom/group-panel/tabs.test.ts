// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { ALL_SCOPE, type GroupScopeModel } from '../../../../src/hud/details-panel/model/index.js';
import { createScopeTabs } from '../../../../src/hud/dom/group-panel/tabs.js';

afterEach(() => document.body.replaceChildren());

const scope = (key: string, label: string, count: number): GroupScopeModel => ({
  key,
  label,
  icon: { glyph: 'people' },
  ids: Array.from({ length: count }, (_, n) => n),
  gear: [],
  military: null,
  siege: null,
  fleet: null,
});

describe('scope tabs', () => {
  it('measures the line again only when a name or the digits of a count change', () => {
    const tabs = createScopeTabs(
      () => {},
      () => {},
    );
    document.body.append(tabs.element);
    let measures = 0;
    Object.defineProperty(tabs.element, 'scrollWidth', {
      get: () => {
        measures++;
        return 0;
      },
    });
    const show = (children: number, civilians: number): void =>
      tabs.update(
        [
          scope(ALL_SCOPE, 'All', children + civilians),
          scope('role:child', 'Children', children),
          scope('role:civilian', 'Civilians', civilians),
        ],
        ALL_SCOPE,
      );

    show(45, 54);
    expect(measures).toBe(1);
    // A child grew up: the counts change but keep their digits, so the line keeps its width.
    show(44, 55);
    expect(measures).toBe(1);
    show(9, 90);
    expect(measures).toBe(2);
  });
});
