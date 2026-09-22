import { expect, it } from 'vitest';
import { gameVersion } from '../build/game-version.js';

it('reads a release version and falls back to dev without one', () => {
  expect(gameVersion('0.0.1')).toBe('0.0.1');
  expect(gameVersion('1.2.3-rc.1')).toBe('1.2.3-rc.1');
  expect(gameVersion(undefined)).toBe('dev');
  expect(gameVersion('')).toBe('dev');
});

it('rejects a tag name or a partial version', () => {
  expect(() => gameVersion('v0.0.1')).toThrow(/semantic version/);
  expect(() => gameVersion('0.1')).toThrow(/semantic version/);
});
