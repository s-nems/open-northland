import { Container, Sprite } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import {
  CHIMNEY_COOL_TICKS,
  CHIMNEY_HOLD_TICKS,
  CHIMNEY_KINDLE_TICKS,
} from '../../../src/data/scene/chimney-smoke.js';
import { ChimneySmoke } from '../../../src/gpu/sprite-pool/chimney-smoke.js';

const HOUSE = 7;
const houses = [{ ref: HOUSE, points: [{ x: -20, y: -90, smoke: 'forge' as const }] }];
const AT_WORK: ReadonlyMap<number, number> = new Map([[HOUSE, 1]]);
const IDLE: ReadonlyMap<number, number> = new Map();

function smokeOver(subject: { container: Container }): Container | undefined {
  return subject.container.children[0];
}

describe('ChimneySmoke', () => {
  it('kindles over a house in view once someone works in it, and dies down after the work', () => {
    const smoke = new ChimneySmoke(() => []);
    const subject = { container: new Container() };
    const subjectOf = () => subject;
    smoke.draw(houses, subjectOf, IDLE, 0, undefined);
    expect(smokeOver(subject)).toBeUndefined();

    smoke.draw(houses, subjectOf, AT_WORK, 1, undefined);
    smoke.draw(houses, subjectOf, AT_WORK, 1 + CHIMNEY_KINDLE_TICKS, undefined);
    const plume = smokeOver(subject);
    expect(plume?.children.some((puff) => puff.visible && puff.alpha > 0)).toBe(true);

    const cold = 1 + CHIMNEY_KINDLE_TICKS + CHIMNEY_HOLD_TICKS + CHIMNEY_COOL_TICKS;
    smoke.draw(houses, subjectOf, IDLE, cold - 1, undefined);
    expect(smokeOver(subject)).toBe(plume);
    smoke.draw(houses, subjectOf, IDLE, cold, undefined);
    expect(smokeOver(subject)).toBeUndefined();
  });

  it('already smokes over a working house that comes into view, and lets go of one that leaves', () => {
    const smoke = new ChimneySmoke(() => []);
    const subject = { container: new Container() };
    smoke.draw(houses, () => subject, AT_WORK, 0, undefined);
    expect(smokeOver(subject)?.children.some((puff) => puff.alpha > 0)).toBe(true);
    smoke.draw([], () => subject, AT_WORK, 1, undefined);
    expect(smokeOver(subject)).toBeUndefined();
  });

  it('leaves a puff where a gust blew it once the wind drops', () => {
    const gust = { strength: 1, direction: 1, gust: 0 };
    const xsAfter = (wind: typeof gust | undefined): number[] => {
      const smoke = new ChimneySmoke(() => []);
      const subject = { container: new Container() };
      smoke.draw(houses, () => subject, AT_WORK, 0, undefined);
      smoke.draw(houses, () => subject, AT_WORK, 6, wind);
      smoke.draw(houses, () => subject, AT_WORK, 7, undefined);
      return smokeOver(subject)?.children.map((puff) => puff.x) ?? [];
    };
    const calm = xsAfter(undefined);
    const blown = xsAfter(gust);
    expect(blown.every((x, i) => x >= (calm[i] ?? 0))).toBe(true);
    expect(blown.some((x, i) => x > (calm[i] ?? 0) + 1)).toBe(true);
  });

  it('starts the plume afresh once the clock ran on past a whole rise', () => {
    const gust = { strength: 1, direction: 1, gust: 0 };
    const LONG_AFTER = 5000;
    const xsAt = (blownBefore: boolean): number[] => {
      const smoke = new ChimneySmoke(() => []);
      const subject = { container: new Container() };
      smoke.draw(houses, () => subject, AT_WORK, 0, blownBefore ? gust : undefined);
      smoke.draw(houses, () => subject, AT_WORK, LONG_AFTER, undefined);
      return smokeOver(subject)?.children.map((puff) => puff.x) ?? [];
    };
    expect(xsAt(true)).toEqual(xsAt(false));
  });

  it('moves back over a body a rebind appended after it', () => {
    const smoke = new ChimneySmoke(() => []);
    const body = new Sprite();
    const subject = { container: new Container(), damageBodies: [body] };
    smoke.draw(houses, () => subject, AT_WORK, 0, undefined);
    subject.container.addChild(body);
    smoke.draw(houses, () => subject, AT_WORK, 1, undefined);
    expect(subject.container.children.at(-1)).not.toBe(body);
  });
});
