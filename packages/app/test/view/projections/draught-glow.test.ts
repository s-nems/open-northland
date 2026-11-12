import { expect, it } from 'vitest';
import { sandboxContent } from '../../../src/game/sandbox/index.js';
import { draughtGlowColours } from '../../../src/view/projections/draught-glow.js';

it('colours the healing, food and stamina potions of the running content and no other draught', () => {
  const goods = sandboxContent().goods;
  const coloured = draughtGlowColours(goods);
  const slugs = goods.filter((good) => coloured.has(good.typeId)).map((good) => good.id);

  expect(slugs.sort()).toEqual([
    'potion_food_big',
    'potion_food_small',
    'potion_heal_big',
    'potion_heal_small',
    'potion_stamina_big',
    'potion_stamina_small',
  ]);
});
