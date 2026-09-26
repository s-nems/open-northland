import { describe, expect, it } from 'vitest';
import { createHouseCardLink, type HoverCard } from '../src/hud/dom/hover-card.js';
import type { BuildingHoverModel, HoverCardModel } from '../src/hud/hover-card/model.js';

const HOUSE = 7;
const OTHER_HOUSE = 8;

/** A card that records what it was asked to show, as the DOM one would draw it. */
function recordingCard(): HoverCard & { shows: number } {
  let shown: HoverCardModel | null = null;
  return {
    shows: 0,
    show(_x, _y, model): void {
      this.shows += 1;
      shown = model;
    },
    hide(): void {
      shown = null;
    },
    showing: () => shown,
    dispose(): void {},
  };
}

function house(id: number, amount: number): BuildingHoverModel {
  return {
    kind: 'building',
    entityId: id,
    title: `house ${id}`,
    state: null,
    health: null,
    rows: [{ label: 'wood', amount }],
  };
}

describe('house card link', () => {
  const POINT = { clientX: 10, clientY: 20 };

  it('follows a resting cursor’s house each tick and goes with a changed house', () => {
    const card = recordingCard();
    let amount = 1;
    const link = createHouseCardLink(card, (id) => house(id, amount));
    link.hover(HOUSE, POINT);
    amount = 2;
    link.update(HOUSE);
    expect(card.showing()).toMatchObject({ rows: [{ amount: 2 }] });
    link.update(OTHER_HOUSE);
    expect(card.showing()).toBeNull();
  });

  it('stays down once its owner hid the card, and leaves a card another link took', () => {
    const card = recordingCard();
    const first = createHouseCardLink(card, (id) => house(id, 1));
    const second = createHouseCardLink(card, (id) => house(id, 1));
    first.hover(HOUSE, POINT);
    card.hide();
    first.update(HOUSE);
    expect(card.showing()).toBeNull();
    first.hover(HOUSE, POINT);
    second.hover(OTHER_HOUSE, POINT);
    first.hover(null, null);
    expect(card.showing()).toMatchObject({ entityId: OTHER_HOUSE });
  });

  it('shows nothing for a house without a card', () => {
    const card = recordingCard();
    createHouseCardLink(card, () => null).hover(HOUSE, POINT);
    expect(card.shows).toBe(0);
  });
});
