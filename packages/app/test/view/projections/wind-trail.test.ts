import { expect, it } from 'vitest';
import { sandboxContent } from '../../../src/game/sandbox/index.js';
import { windTrailGoods } from '../../../src/view/projections/wind-trail.js';

it('names the goods of the running content that shorten a carried step', () => {
  const goods = sandboxContent().goods;
  const fast = windTrailGoods(goods);

  expect(goods.filter((good) => fast.has(good.typeId)).map((good) => good.id)).toEqual(['amulet_speed']);
});
